#!/usr/bin/env bash
# 在画布站点上再装一层「dsh 小窗」：
#   1. /dsh-embed/ 静态资源（悬浮按钮 + 面板）
#   2. dsh-embed-login 登录桥（把 iframe 换到画布同源下）
#   3. 画布库脚本 canvas-save / canvas-library
#   4. dsh 浏览器插件 dsh-canvas-session：一张画布一个会话
#
# 前置：先跑过仓库根目录的 ./install.sh（有画布站点和令牌门禁），
#      并且 dsh-web 跑在本机 127.0.0.1:8790。
# 用法：sudo ./dsh-embed/install.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
DRAW="/var/www/canvas-library/drawings"
WEB="/var/www/canvas-embed"
DSH_PORT="${DSH_PORT:-8790}"
SITE="${CANVAS_SITE:-/etc/nginx/sites-available/excalidraw-canvas}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行"
[ -d "$RUN_HOME" ] || die "取不到 $RUN_USER 的家目录"
command -v node >/dev/null || die "缺少 node"

if ! grep -q 'location /dsh/' "$SITE" 2>/dev/null; then
  warn "$SITE 里没有 /dsh/ 反代——请用仓库里的 templates/excalidraw-canvas.site.tpl 重建站点后再装"
fi

# 1) 静态资源
log "安装面板静态资源 → $WEB"
install -d -m 755 "$WEB"
install -m 644 "$HERE/web/embed.js" "$HERE/web/embed.css" "$WEB/"
chgrp www-data "$WEB"/embed.* 2>/dev/null || true

# 2) 画布库脚本
log "安装 canvas-save / canvas-library → /usr/local/bin"
install -m 755 "$HERE/bin/canvas-save" "$HERE/bin/canvas-library" /usr/local/bin/

install -d -m 2755 -o "$RUN_USER" -g www-data "$DRAW"
ln -sfn "$DRAW" "$RUN_HOME/canvases"
if [ ! -f /var/www/canvas-library/index.html ]; then
  log "生成画布库首页"
  chown -R "$RUN_USER":www-data /var/www/canvas-library
  sudo -u "$RUN_USER" /usr/local/bin/canvas-library >/dev/null
fi

# 3) 登录桥
log "安装 dsh-embed-login"
install -m 755 "$HERE/login/dsh-embed-login.py" "$RUN_HOME/dsh-embed-login.py"
chown "$RUN_USER:$RUN_USER" "$RUN_HOME/dsh-embed-login.py"
sed -e "s|__RUN_USER__|$RUN_USER|g" \
    -e "s|__RUN_HOME__|$RUN_HOME|g" \
    "$HERE/login/dsh-embed-login.service.tpl" > /etc/systemd/system/dsh-embed-login.service
systemctl daemon-reload
systemctl enable dsh-embed-login.service >/dev/null
systemctl restart dsh-embed-login.service

# 4) 一画布一 session 插件
log "接线 dsh-canvas-session 插件"
PROFILE_DIR="$RUN_HOME/.dsh/profiles/web"
install -d "$PROFILE_DIR/node_modules"
ln -sfn "$HERE/plugin/dsh-canvas-session" "$PROFILE_DIR/node_modules/dsh-canvas-session"
PATCH="$PROFILE_DIR/cordis.patch.yml"
if [ -f "$PATCH" ] && ! grep -q 'canvas-session' "$PATCH"; then
  cp "$PATCH" "$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
  sudo -u "$RUN_USER" tee -a "$PATCH" >/dev/null <<'YAML'

# 画布小窗：一张画布一个 session（浏览器端插件，见 dsh-embed/plugin）
- insert:
    - id: canvas-session
      name: dsh-canvas-session
YAML
  log "已把插件条目写入 $PATCH（host 会热加载，无需重启 dsh-web）"
fi

# 5) 收尾检查
systemctl reload nginx
sleep 1
curl -fsS --max-time 3 "http://127.0.0.1:9110/healthz" >/dev/null \
  || die "登录桥 127.0.0.1:9110 不通，看 systemctl status dsh-embed-login"

TOKEN="$(cat /etc/excalidraw-canvas/token 2>/dev/null || true)"
DOMAIN="$(awk '/server_name/ {print $2; exit}' "$SITE" | tr -d ';')"
cat <<EOF

============================================================
dsh 小窗已就绪
  画布      https://$DOMAIN/?k=$TOKEN
  画布库    https://$DOMAIN/library/
  小窗      画布页右下角「💬 dsh 」
  会话规则  每张画布一个会话，标题「画布 · <文件名>」，工作区 ~/canvases
============================================================
EOF

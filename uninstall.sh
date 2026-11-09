#!/usr/bin/env bash
# 卸载画布：停服务、删 nginx 站点与门禁、删令牌目录。npm 包和证书保留。
set -euo pipefail

STATE_DIR="/etc/excalidraw-canvas"
die() { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行"

echo "==> 停用 excalidraw-canvas 服务"
systemctl disable --now excalidraw-canvas.service 2>/dev/null || true
rm -f /etc/systemd/system/excalidraw-canvas.service
systemctl daemon-reload

echo "==> 移除 nginx 站点与门禁"
rm -f /etc/nginx/sites-enabled/excalidraw-canvas.conf \
      /etc/nginx/sites-available/excalidraw-canvas.conf \
      /etc/nginx/sites-enabled/excalidraw-canvas \
      /etc/nginx/sites-available/excalidraw-canvas \
      /etc/nginx/sites-enabled/excalidraw-canvas.acme.conf \
      /etc/nginx/sites-available/excalidraw-canvas.acme.conf \
      /etc/nginx/conf.d/canvas-link.conf
nginx -t && systemctl reload nginx

if [ "${1:-}" = "--with-embed" ]; then
  RUN_USER="${SUDO_USER:-$(id -un)}"
  RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  echo "==> 卸载 dsh 小窗"
  systemctl disable --now dsh-embed-login.service 2>/dev/null || true
  rm -f /etc/systemd/system/dsh-embed-login.service
  systemctl daemon-reload
  rm -f "$RUN_HOME/dsh-embed-login.py" /usr/local/bin/canvas-save /usr/local/bin/canvas-library
  rm -rf /var/www/canvas-embed
  rm -f "$RUN_HOME/.dsh/profiles/web/node_modules/dsh-canvas-session"
  echo "   画布库文件保留在 /var/www/canvas-library（要删自己 rm -rf）"
fi

echo "==> 删除令牌目录"
rm -rf "$STATE_DIR"

cat <<EOF
已卸载。保留项：
  - npm 包：npm rm -g mcp-excalidraw-server
  - 证书  ：certbot delete --cert-name <域名>
  - dsh 配置：手动删 ~/.dsh/profiles/*/cordis.patch.yml 里的 mcp-excalidraw 与
              canvas-session 条目
  - dsh 小窗：sudo ./uninstall.sh --with-embed 一并清理
EOF

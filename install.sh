#!/usr/bin/env bash
# 安装 Excalidraw 直播画布：npm 包 + systemd 常驻 + nginx 令牌门禁 + Let's Encrypt 证书
# 用法: sudo ./install.sh [canvas.example.com]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="mcp-excalidraw-server@2.1.2"
PORT="${EXCALIDRAW_PORT:-3000}"
COOKIE_NAME="exc_link"
STATE_DIR="/etc/excalidraw-canvas"
SITE_NAME="excalidraw-canvas"
DOMAIN="${1:-}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行"
for bin in node npm nginx certbot curl; do
  command -v "$bin" >/dev/null 2>&1 || die "缺少命令：$bin"
done

NODE_BIN="$(command -v node)"
NPM_ROOT="$(npm root -g)"
RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
[ -n "$RUN_HOME" ] || die "取不到 $RUN_USER 的家目录"

if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
  [ -n "$IP" ] || die "推断不出公网 IP，请显式传域名：sudo ./install.sh canvas.example.com"
  DOMAIN="canvas-$(printf '%s' "$IP" | tr '.' '-').sslip.io"
fi
log "域名 $DOMAIN / 端口 $PORT / 运行用户 $RUN_USER"

render() {
  sed -e "s|__DOMAIN__|$DOMAIN|g" \
      -e "s|__PORT__|$PORT|g" \
      -e "s|__RUN_USER__|$RUN_USER|g" \
      -e "s|__RUN_HOME__|$RUN_HOME|g" \
      -e "s|__NODE_BIN__|$NODE_BIN|g" \
      -e "s|__COOKIE_NAME__|$COOKIE_NAME|g" \
      "$1"
}

# 1) npm 包
if [ ! -f "$NPM_ROOT/mcp-excalidraw-server/dist/server.js" ]; then
  log "安装 $PKG"
  npm install -g "$PKG"
else
  log "已存在 $NPM_ROOT/mcp-excalidraw-server，跳过安装"
fi
SERVER_JS="$NPM_ROOT/mcp-excalidraw-server/dist/server.js"
MCP_ENTRY="$NPM_ROOT/mcp-excalidraw-server/dist/index.js"
[ -f "$SERVER_JS" ] || die "找不到 $SERVER_JS"
[ -f "$MCP_ENTRY" ] || die "找不到 $MCP_ENTRY"

# 2) systemd
log "写 systemd 单元"
render "$REPO_DIR/templates/excalidraw-canvas.service.tpl" \
  | sed -e "s|__SERVER_JS__|$SERVER_JS|g" > "/etc/systemd/system/excalidraw-canvas.service"
systemctl daemon-reload
systemctl enable excalidraw-canvas.service >/dev/null
systemctl restart excalidraw-canvas.service

# 3) 令牌 + nginx 门禁
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
if [ ! -s "$STATE_DIR/token" ]; then
  log "生成访问令牌"
  ( umask 077; head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$STATE_DIR/token" )
fi
TOKEN="$(cat "$STATE_DIR/token")"

log "写 nginx 令牌门禁"
render "$REPO_DIR/templates/canvas-link.conf.tpl" | sed -e "s|__TOKEN__|$TOKEN|g" \
  > /etc/nginx/conf.d/canvas-link.conf

mkdir -p /var/www/acme

# 4) 证书：先用临时 80 端口站点过 ACME，再启用完整站点
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  log "证书已存在，跳过签发"
else
  log "申请 Let's Encrypt 证书（webroot）"
  cat > "/etc/nginx/sites-available/$SITE_NAME.acme.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 200 "acme\n"; }
}
EOF
  ln -sf "/etc/nginx/sites-available/$SITE_NAME.acme.conf" "/etc/nginx/sites-enabled/$SITE_NAME.acme.conf"
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/acme -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
  rm -f "/etc/nginx/sites-enabled/$SITE_NAME.acme.conf"
fi

log "启用画布站点"
render "$REPO_DIR/templates/excalidraw-canvas.site.tpl" > "/etc/nginx/sites-available/$SITE_NAME.conf"
ln -sf "/etc/nginx/sites-available/$SITE_NAME.conf" "/etc/nginx/sites-enabled/$SITE_NAME.conf"
nginx -t
systemctl reload nginx

# 5) 等画布起来
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null || die "画布没有在 127.0.0.1:$PORT 起来，看 systemctl status excalidraw-canvas"
curl -fsS --max-time 5 "https://$DOMAIN/healthz" >/dev/null || warn "公网 /healthz 不通，检查 DNS 和防火墙"

cat <<EOF

============================================================
画布已就绪
  访问链接  https://$DOMAIN/?k=$TOKEN
  本机健康  http://127.0.0.1:$PORT/health
  令牌文件  $STATE_DIR/token

下一步接 dsh：
  $REPO_DIR/scripts/install-dsh-mcp.sh web && sudo systemctl restart dsh-web
============================================================
EOF

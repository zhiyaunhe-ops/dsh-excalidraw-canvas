#!/usr/bin/env bash
# 打印 / 轮换画布访问链接
# 用法: sudo ./scripts/canvas-link.sh [--rotate]
set -euo pipefail

STATE_DIR="/etc/excalidraw-canvas"
SITE="/etc/nginx/sites-available/excalidraw-canvas.conf"
LINK_CONF="/etc/nginx/conf.d/canvas-link.conf"
COOKIE_NAME="exc_link"

die() { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }
[ -s "$STATE_DIR/token" ] || die "没有令牌文件 $STATE_DIR/token，先跑 install.sh"
[ -f "$SITE" ] || die "没有 $SITE，先跑 install.sh"

DOMAIN="$(awk '/server_name/ {print $2; exit}' "$SITE" | tr -d ';')"
[ -n "$DOMAIN" ] || die "解析不出域名"

if [ "${1:-}" = "--rotate" ]; then
  [ "$(id -u)" -eq 0 ] || die "--rotate 需要 sudo"
  OLD="$(cat "$STATE_DIR/token")"
  NEW="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ( umask 077; printf '%s' "$NEW" > "$STATE_DIR/token" )
  sed -i "s|$OLD|$NEW|g" "$LINK_CONF"
  nginx -t >/dev/null && systemctl reload nginx
  echo "已轮换令牌，旧链接与已下发的 cookie 立即失效"
  TOKEN="$NEW"
else
  TOKEN="$(cat "$STATE_DIR/token")"
fi

echo "https://$DOMAIN/?k=$TOKEN"
echo "（首次打开后浏览器会拿到 $COOKIE_NAME cookie，之后直接访问 https://$DOMAIN/ 即可）"

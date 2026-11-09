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

echo "==> 删除令牌目录"
rm -rf "$STATE_DIR"

cat <<EOF
已卸载。保留项：
  - npm 包：npm rm -g mcp-excalidraw-server
  - 证书  ：certbot delete --cert-name <域名>
  - dsh 配置：手动删 ~/.dsh/profiles/*/cordis.patch.yml 里的 mcp-excalidraw 条目
EOF

#!/usr/bin/env bash
# Install/update the cloud workspace without restarting or clearing the MCP canvas.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
NODE_BIN="$(command -v node)"
PACKAGE_DIR="$(npm root -g)/mcp-excalidraw-server"
PORT="${EXCALIDRAW_PORT:-3000}"
SITE="${CANVAS_SITE:-/etc/nginx/sites-available/excalidraw-canvas}"
[ "$(id -u)" -eq 0 ] || { echo '请用 sudo 运行' >&2; exit 1; }
[ -f "$SITE" ] || SITE="${SITE}.conf"
[ -f "$PACKAGE_DIR/dist/server.js" ] || { echo '请先安装 mcp-excalidraw-server' >&2; exit 1; }

# Keep the existing library and a one-time upgrade copy of the running scene.
STAMP="$(date +%Y%m%d-%H%M%S)"
install -d -o "$RUN_USER" -g www-data /var/www/canvas-library/drawings
if [ ! -f /etc/systemd/system/canvas-workspace.service ]; then
  cp -a /var/www/canvas-library "/var/www/canvas-library-before-workspace-$STAMP"
fi
sudo -u "$RUN_USER" env PATH="$PATH" bash -c 'cd "$1" && npm ci --no-audit --no-fund && npm run build' bash "$REPO_DIR/app"
sed -e "s|__RUN_USER__|$RUN_USER|g" -e "s|__REPO_DIR__|$REPO_DIR|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" -e "s|__PACKAGE_DIR__|$PACKAGE_DIR|g" \
  -e "s|__PORT__|$PORT|g" "$REPO_DIR/templates/canvas-workspace.service.tpl" \
  > /etc/systemd/system/canvas-workspace.service
chown "$RUN_USER":www-data /var/www/canvas-library
systemctl daemon-reload
systemctl enable canvas-workspace.service
systemctl restart canvas-workspace.service

# Migration and browser binding call this API immediately after installation.
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:9111/workspace/api/documents >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:9111/workspace/api/documents >/dev/null \
  || { echo '工作空间未就绪；查看 journalctl -u canvas-workspace' >&2; exit 1; }

# Replace only the old canvas/library page routes; keep the installed site settings.
cp "$SITE" "$SITE.before-workspace-$STAMP"
python3 - "$SITE" <<'PY'
from pathlib import Path
import re, sys
site = Path(sys.argv[1])
text = site.read_text().replace('    # 画布首页：注入一个回到画布库的悬浮按钮（只改这一份 HTML，不碰静态资源）', '    # 云端画布工作空间')
page = '''    location = / {
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        add_header Cache-Control "no-store" always;
        proxy_pass http://127.0.0.1:9111;
    }
'''
# Match each complete location, including its nested one-line if block.
text = re.sub(r'    location = / \{\n.*?\n    \}', page.rstrip(), text, flags=re.S)
library = '''    location /library/ {
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        proxy_pass http://127.0.0.1:9111;
    }
'''
text = re.sub(r'    location /library/ \{\n.*?\n    \}', library.rstrip(), text, flags=re.S)
if 'location /workspace/' not in text:
    routes = '''    location /workspace/ {
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        proxy_pass http://127.0.0.1:9111;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $canvas_conn;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }

    location /canvas/ {
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        add_header Cache-Control "no-store" always;
        proxy_pass http://127.0.0.1:9111;
    }

    location /library/drawings/ {
        if ($exc_deny) { return 403; }
        alias /var/www/canvas-library/drawings/;
    }

'''
    text = text.replace('    location = /dsh/login {', routes + '    location = /dsh/login {')
site.write_text(text)
PY
nginx -t
systemctl reload nginx
printf '云端画布已更新。画布库 /library/，文档 /canvas/<id>\n'

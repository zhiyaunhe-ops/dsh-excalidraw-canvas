#!/usr/bin/env bash
# Hot-load the host scope plugin without restarting DSH or its assistant frames.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
PROFILE="$RUN_HOME/.dsh/profiles/web"
SITE="${CANVAS_SITE:-/etc/nginx/sites-available/excalidraw-canvas}"
[ -f "$SITE" ] || SITE="${SITE}.conf"
DOMAIN="$(awk '/server_name/ {print $2; exit}' "$SITE" | tr -d ';')"
[ "$(id -u)" -eq 0 ] || { echo '请用 sudo 运行' >&2; exit 1; }
[ -f "$PROFILE/cordis.patch.yml" ] || { echo '未安装 DSH web profile，跳过会话插件'; exit 0; }
install -d "$PROFILE/node_modules"
ln -sfn "$REPO_DIR/dsh-embed/plugin/dsh-canvas-session" "$PROFILE/node_modules/dsh-canvas-session"
# Bind old canvas sessions before enabling the tool wrapper.
sudo -u "$RUN_USER" env DSH_RUN_HOME="$RUN_HOME" python3 "$REPO_DIR/scripts/bind-existing-sessions.py"
python3 - "$PROFILE/cordis.patch.yml" "$REPO_DIR" "$DOMAIN" <<'PY'
from pathlib import Path
import json, re, sys, time
patch = Path(sys.argv[1])
text = patch.read_text()
host = Path(sys.argv[2]) / 'dsh-embed/plugin/dsh-canvas-session/host.js'
module = host.as_uri() + '?revision=' + str(host.stat().st_mtime_ns)
if 'id: canvas-session-scope' not in text:
    patch.with_name(patch.name + '.before-canvas-scope-' + time.strftime('%Y%m%d-%H%M%S')).write_text(text)
    text += '\n# 画布会话上下文与工具目标绑定（热加载，无需重启 DSH）\n- insert:\n    - id: canvas-session-scope\n      name: ' + json.dumps(module) + '\n      config:\n        libraryDir: /var/www/canvas-library\n        workspaceUrl: http://127.0.0.1:9111\n        publicUrl: ' + json.dumps('https://' + sys.argv[3]) + '\n'
else:
    text = re.sub(r'(id: canvas-session-scope\n\s+name:) [^\n]+', lambda match: match.group(1) + ' ' + json.dumps(module), text)
patch.write_text(text)
PY
printf '画布上下文与工具范围插件已接入；DSH 将热加载配置。\n'

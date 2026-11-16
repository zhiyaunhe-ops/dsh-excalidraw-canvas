#!/usr/bin/env bash
# 把 excalidraw MCP 客户端接进 dsh 的某个 profile
# 用法: ./scripts/install-dsh-mcp.sh [profile]   （默认 web）
set -euo pipefail

PROFILE="${1:-web}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
PATCH="$PROFILE_DIR/cordis.patch.yml"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$PROFILE_DIR/package.json" ] || die "profile 未初始化：$PROFILE_DIR；先启动并配置 DSH web"
command -v dsh >/dev/null 2>&1 || die "找不到 dsh 命令"

NODE_BIN="$(command -v node)"
NPM_ROOT="$(npm root -g)"
MCP_ENTRY="$REPO_DIR/app/mcp-router.mjs"
[ -f "$NPM_ROOT/mcp-excalidraw-server/dist/index.js" ] || die "先跑 install.sh 准备画布服务"
[ -f "$REPO_DIR/app/node_modules/@modelcontextprotocol/server/package.json" ] || die "先运行工作空间安装，准备 app 依赖"
PUBLIC_URL="${CANVAS_PUBLIC_URL:-}"
if [ -z "$PUBLIC_URL" ]; then
  SITE="${CANVAS_SITE:-/etc/nginx/sites-available/excalidraw-canvas}"
  [ -f "$SITE" ] || SITE="${SITE}.conf"
  DOMAIN="$(awk '/server_name/ {print $2; exit}' "$SITE" 2>/dev/null | tr -d ';' || true)"
  PUBLIC_URL="${DOMAIN:+https://$DOMAIN}"
fi
PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:9111}"

# This is a plain host plugin dependency, not an installable DSH bundle.
if [ ! -f "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-mcp-client/package.json" ]; then
  command -v pnpm >/dev/null || die "缺少 pnpm，无法安装 profile 的 MCP client 依赖"
  log "安装 web profile 的 MCP client 依赖"
  pnpm --dir "$PROFILE_DIR" add --save-exact @deepseek-ai/dsh-mcp-client@0.2.1-rc.2
fi

touch "$PATCH"
python3 - "$PATCH" "$REPO_DIR/templates/cordis.patch.insert.yml.tpl" "$NODE_BIN" "$MCP_ENTRY" "$HOME" "$PUBLIC_URL" <<'PY'
from pathlib import Path
import re, sys
patch, template = map(Path, sys.argv[1:3])
text = patch.read_text()
rendered = template.read_text()
for key, value in zip(('__NODE_BIN__', '__MCP_ENTRY__', '__RUN_HOME__', '__PUBLIC_URL__'), sys.argv[3:]):
    rendered = rendered.replace(key, value)
if 'id: mcp-excalidraw' in text:
    block = rendered[rendered.index('    - id: mcp-excalidraw'):]
    text, count = re.subn(r'(?m)^    - id: mcp-excalidraw\n(?: {6,}[^\n]*\n|[ \t]*\n)*', lambda _: block, text if text.endswith('\n') else text + '\n')
    if count != 1: raise SystemExit('无法定位 mcp-excalidraw 配置块，请检查 profile patch 缩进')
else:
    text = text.rstrip() + '\n' + rendered
if text != patch.read_text():
    patch.with_name(patch.name + '.bak-before-excalidraw').write_text(patch.read_text())
    patch.write_text(text)
PY
log "已接入按画布隔离的 MCP 路由"

log "校验合成后的配置"
dsh --profile "$PROFILE" --dump-config 2>&1 | grep -q "mcp-excalidraw" \
  || die "配置里没合成出 mcp-excalidraw，检查 $PATCH 的 YAML"

log "运行中的 DSH 会热加载 MCP 配置，无需重启助手或整个 dsh 服务"

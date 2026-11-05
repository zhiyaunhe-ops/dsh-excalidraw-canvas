#!/usr/bin/env bash
# 把 excalidraw MCP 客户端接进 dsh 的某个 profile
# 用法: ./scripts/install-dsh-mcp.sh [profile]   （默认 web）
set -euo pipefail

PROFILE="${1:-web}"
PORT="${EXCALIDRAW_PORT:-3000}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$HOME/.dsh/profiles/$PROFILE/cordis.patch.yml"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$HOME/.dsh/profiles/$PROFILE" ] || die "没有 profile 目录：$HOME/.dsh/profiles/$PROFILE"
command -v dsh >/dev/null 2>&1 || die "找不到 dsh 命令"

NODE_BIN="$(command -v node)"
NPM_ROOT="$(npm root -g)"
MCP_ENTRY="$NPM_ROOT/mcp-excalidraw-server/dist/index.js"
[ -f "$MCP_ENTRY" ] || die "找不到 $MCP_ENTRY，先跑 install.sh"

touch "$PATCH"
if grep -q "id: mcp-excalidraw" "$PATCH"; then
  log "$PATCH 里已有 mcp-excalidraw，跳过写入"
else
  cp "$PATCH" "$PATCH.bak-before-excalidraw"
  log "备份到 $PATCH.bak-before-excalidraw"
  [ -z "$(tail -c 1 "$PATCH")" ] || echo "" >> "$PATCH"
  sed -e "s|__NODE_BIN__|$NODE_BIN|g" \
      -e "s|__MCP_ENTRY__|$MCP_ENTRY|g" \
      -e "s|__PORT__|$PORT|g" \
      -e "s|__RUN_HOME__|$HOME|g" \
      "$REPO_DIR/templates/cordis.patch.insert.yml.tpl" >> "$PATCH"
  log "已追加 insert 条目"
fi

log "校验合成后的配置"
dsh --profile "$PROFILE" --dump-config 2>&1 | grep -q "mcp-excalidraw" \
  || die "配置里没合成出 mcp-excalidraw，检查 $PATCH 的 YAML"

SVC="dsh-$PROFILE"
if systemctl list-unit-files 2>/dev/null | grep -q "^$SVC.service"; then
  log "重启 $SVC"
  sudo systemctl restart "$SVC"
  sleep 3
  ps -eo args --no-headers | grep -F "mcp-excalidraw-server/dist/index.js" | grep -v grep >/dev/null \
    && log "MCP 子进程已在运行" || printf '\033[1;33m warn\033[0m 没看到 MCP 子进程，看 journalctl -u %s\n' "$SVC"
else
  log "没有 $SVC 服务，手动重启你的 dsh 会话生效"
fi

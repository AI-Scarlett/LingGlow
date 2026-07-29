#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE=""
TARGET="${1:-codex}"

select_trusted_embedded_node() {
  local app="$1"
  local candidate="$app/Contents/Resources/cua_node/bin/node"
  [[ -z "$NODE" && -x "$candidate" ]] || return 0
  /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1 || return 0
  /usr/bin/codesign -dv --verbose=4 "$app" 2>&1 | /usr/bin/grep -q '^TeamIdentifier=2DC432GLL2$' || return 0
  "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1 || return 0
  NODE="$candidate"
}

select_compatible_node() {
  local candidate="${1:-}"
  [[ -z "$NODE" && "$candidate" == /* && -x "$candidate" ]] || return 0
  "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1 || return 0
  NODE="$candidate"
}

if [[ -n "${CODEX_SKIN_STUDIO_APP:-}" ]]; then
  select_trusted_embedded_node "$CODEX_SKIN_STUDIO_APP"
fi
select_trusted_embedded_node "/Applications/ChatGPT.app"
select_trusted_embedded_node "/Applications/Codex.app"
select_trusted_embedded_node "$HOME/Applications/ChatGPT.app"
select_trusted_embedded_node "$HOME/Applications/Codex.app"
select_compatible_node "${CODEX_SKIN_STUDIO_NODE:-}"
select_compatible_node "$(command -v node || true)"
select_compatible_node "/opt/homebrew/bin/node"
select_compatible_node "/usr/local/bin/node"
select_compatible_node "/opt/local/bin/node"
if [[ -z "$NODE" ]]; then
  /usr/bin/osascript -e 'display alert "灵妆" message "未找到 Node.js 22+ 运行时；请安装带内置 Node 的 ChatGPT / Codex，或安装 Node.js 22 或更高版本。" as critical'
  exit 1
fi
if [[ ! -x "$NODE" ]] || ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display alert "灵妆" message "恢复工具需要 Node.js 22 或更高版本。" as critical'
  exit 1
fi
exec "$NODE" "$ROOT/src/cli.mjs" restore-stock "$TARGET"

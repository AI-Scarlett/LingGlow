#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE=""
PACKAGED_APP=""
TEAM_ID=""

detect_packaged_app() {
  local candidate=""
  candidate="$(cd "$ROOT/../../.." 2>/dev/null && pwd || true)"
  [[ -n "$candidate" && "$candidate" == *.app && -f "$candidate/Contents/Info.plist" ]] || return 0
  local expected_root="$candidate/Contents/Resources/LingGlowBackend"
  [[ "$ROOT" == "$expected_root" ]] || return 0
  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$bundle_id" == "local.skin-studio.menubar" ]] || return 0
  TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :LingGlowDeveloperTeamID' "$candidate/Contents/Info.plist" 2>/dev/null || true)"
  PACKAGED_APP="$candidate"
}

detect_packaged_app

if [[ "${LINGGLOW_FORCE_STRICT:-0}" == "1" ]]; then
  export LINGGLOW_ALLOW_UNVERIFIED_CLIENTS="${LINGGLOW_ALLOW_UNVERIFIED_CLIENTS:-0}"
  export LINGGLOW_RELAX_PROCESS_VERIFICATION="${LINGGLOW_RELAX_PROCESS_VERIFICATION:-0}"
else
  : "${LINGGLOW_ALLOW_UNVERIFIED_CLIENTS:=1}"
  : "${LINGGLOW_RELAX_PROCESS_VERIFICATION:=1}"
  if [[ -z "${LINGGLOW_SKIP_SERVICE_IDENTITY_CHECK:-}" ]]; then
    if [[ -n "$PACKAGED_APP" && -z "$TEAM_ID" ]]; then
      export LINGGLOW_SKIP_SERVICE_IDENTITY_CHECK=1
    fi
  fi
fi

show_error() {
  /usr/bin/osascript -e "display alert \"灵妆\" message \"$1\" as critical"
}

launch_menubar() {
  local app="${PACKAGED_APP:-$ROOT/灵妆.app}"
  if [[ -z "$PACKAGED_APP" && ! -d "$app" && -d "$ROOT/Skin Studio.app" ]]; then
    app="$ROOT/Skin Studio.app"
  fi
  if [[ ! -d "$app" ]]; then
    show_error "缺少灵妆.app。请保留完整发行文件夹，或重新运行原生构建脚本。"
    exit 1
  fi
  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$bundle_id" != "local.skin-studio.menubar" ]] || ! /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
    show_error "菜单栏应用未通过本地完整性校验，已拒绝启动。"
    exit 1
  fi
  exec /usr/bin/open -g "$app"
}

case "${1:-}" in
  ""|--menubar)
    launch_menubar
    ;;
  --background|--dashboard)
    ;;
  *)
    show_error "未知启动参数。"
    exit 1
    ;;
esac

select_trusted_embedded_node() {
  local app="$1"
  local candidate="$app/Contents/Resources/cua_node/bin/node"
  [[ -z "$NODE" && -x "$candidate" ]] || return 0
  /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1 || return 0
  /usr/bin/codesign -dv --verbose=4 "$app" 2>&1 | /usr/bin/grep -q '^TeamIdentifier=2DC432GLL2$' || return 0
  "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1 || return 0
  NODE="$candidate"
}

select_lingglow_bundled_node() {
  [[ -n "$PACKAGED_APP" && -z "$NODE" ]] || return 0
  local architecture
  architecture="$(/usr/bin/uname -m)"
  case "$architecture" in
    arm64) ;;
    x86_64) ;;
    *) return 0 ;;
  esac
  local candidate="$ROOT/../LingGlowNodeRuntime/$architecture/node"
  [[ -f "$candidate" && ! -L "$candidate" && -x "$candidate" ]] || return 0
  /usr/bin/codesign --verify --deep --strict "$PACKAGED_APP" >/dev/null 2>&1 || return 0
  "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1 || return 0
  NODE="$candidate"
}

select_compatible_node() {
  local candidate="${1:-}"
  [[ -z "$NODE" && "$candidate" == /* && -x "$candidate" ]] || return 0
  "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1 || return 0
  NODE="$candidate"
}

# A formally signed release runs only on interpreters that carry a verified
# signature: the runtime inside its own signed bundle, or a signed embedded
# runtime of a pinned publisher. An arbitrary node on PATH is covered by no
# signature and no runtime-identity manifest.
release_runtime_pinned() {
  [[ -n "$PACKAGED_APP" && "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]
}

if [[ -z "$PACKAGED_APP" && -z "${LINGGLOW_PACKAGED_RUNTIME:-}" && -n "${CODEX_SKIN_STUDIO_APP:-}" ]]; then
  select_trusted_embedded_node "$CODEX_SKIN_STUDIO_APP"
fi
select_lingglow_bundled_node
select_trusted_embedded_node "/Applications/ChatGPT.app"
select_trusted_embedded_node "/Applications/Codex.app"
select_trusted_embedded_node "$HOME/Applications/ChatGPT.app"
select_trusted_embedded_node "$HOME/Applications/Codex.app"
if [[ -z "$PACKAGED_APP" && -z "${LINGGLOW_PACKAGED_RUNTIME:-}" ]]; then
  select_compatible_node "${CODEX_SKIN_STUDIO_NODE:-}"
fi
if ! release_runtime_pinned; then
  select_compatible_node "$(command -v node || true)"
  select_compatible_node "/opt/homebrew/bin/node"
  select_compatible_node "/usr/local/bin/node"
  select_compatible_node "/opt/local/bin/node"
elif [[ -z "$NODE" ]]; then
  echo "灵妆内置 Node 运行时未通过完整性校验，已拒绝改用未校验的本机 Node 运行签名后端。" >&2
  exit 1
fi
if [[ -z "$NODE" ]]; then
  /usr/bin/osascript -e 'display alert "灵妆" message "未找到 Node.js 22+ 运行时；请安装带内置 Node 的 ChatGPT / Codex，或安装 Node.js 22 或更高版本。" as critical'
  exit 1
fi

if [[ ! -x "$NODE" ]] || ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display alert "灵妆" message "需要 Node.js 22 或更高版本。请更新 ChatGPT / Codex、安装系统 Node.js，或设置 CODEX_SKIN_STUDIO_NODE。" as critical'
  exit 1
fi

if [[ "${1:-}" == "--background" ]]; then
  exec "$NODE" "$ROOT/src/cli.mjs" dashboard
fi

exec "$NODE" "$ROOT/src/cli.mjs" dashboard --open

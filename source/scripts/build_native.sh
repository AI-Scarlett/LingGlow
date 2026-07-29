#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_DIR="$PROJECT_ROOT/native"
OUTPUT_APP="$PROJECT_ROOT/灵妆.app"
LEGACY_OUTPUT_APP="$PROJECT_ROOT/Skin Studio.app"
LEGACY_LAUNCHER_APP="$PROJECT_ROOT/Codex Skin Studio.app"
EXECUTABLE_NAME="SkinStudio"
BUNDLE_ID="local.skin-studio.menubar"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
LINGGLOW_DEVELOPER_TEAM_ID="${LINGGLOW_DEVELOPER_TEAM_ID:-}"
MENU_BAR_TEMPLATE="$NATIVE_DIR/Resources/LingGlowMenuBarTemplate.svg"
MENU_BAR_ICON="$NATIVE_DIR/Resources/LingGlowMenuBarIcon.png"
LOCALIZATIONS_DIR="$NATIVE_DIR/Resources/Localizations"
OPTIONAL_APP_ICON="$NATIVE_DIR/Resources/LingGlowAppIcon.icns"
SHELL_BACKGROUND="$NATIVE_DIR/Resources/LingGlowShellBackground.webp"
NODE_RUNTIME_SOURCE_DIR="$NATIVE_DIR/Resources/NodeRuntime"
NODE_RUNTIME_INSTALLER="$SCRIPT_DIR/fetch_node_runtime.mjs"
THIRD_PARTY_NOTICES_SOURCE="$PROJECT_ROOT/THIRD_PARTY_NOTICES.md"
REQUIRE_BUNDLED_NODE_RUNTIME="${REQUIRE_BUNDLED_NODE_RUNTIME:-0}"
DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.0}"
ARCHS="${ARCHS:-$(/usr/bin/uname -m)}"
NODE_RUNTIME_ARCHS="${NODE_RUNTIME_ARCHS:-$ARCHS}"
SWIFTC="${SWIFTC:-$(/usr/bin/xcrun --find swiftc)}"
SDKROOT="${SDKROOT:-$(/usr/bin/xcrun --sdk macosx --show-sdk-path)}"
NODE_BIN="${NODE:-$(command -v node || true)}"

read -r -a NODE_RUNTIME_ARCH_LIST <<< "$NODE_RUNTIME_ARCHS"
if (( ${#NODE_RUNTIME_ARCH_LIST[@]} < 1 )); then
  echo "NODE_RUNTIME_ARCHS 不能为空" >&2
  exit 1
fi
for runtime_arch in "${NODE_RUNTIME_ARCH_LIST[@]}"; do
  if [[ "$runtime_arch" != "arm64" && "$runtime_arch" != "x86_64" ]]; then
    echo "不支持的 Node 运行时架构：$runtime_arch" >&2
    exit 1
  fi
done

if [[ ! -f "$NATIVE_DIR/Info.plist" ]]; then
  echo "缺少 native/Info.plist" >&2
  exit 1
fi
if [[ -z "$NODE_BIN" ]] || ! "$NODE_BIN" --version >/dev/null 2>&1; then
  echo "构建原生菜单栏应用需要可用的 Node.js，以生成统一 Agent 注册表桥接代码" >&2
  exit 1
fi
NODE_VERSION="$($NODE_BIN --version 2>/dev/null || true)"
if [[ ! "$NODE_VERSION" =~ ^v([0-9]+)\. ]] || (( BASH_REMATCH[1] < 22 )); then
  echo "构建原生菜单栏应用需要 Node.js 22 或更高版本；当前为 ${NODE_VERSION:-unknown}" >&2
  exit 1
fi
"$NODE_BIN" "$SCRIPT_DIR/generate_native_client_registry.mjs"
if [[ "$REQUIRE_BUNDLED_NODE_RUNTIME" != "0" && "$REQUIRE_BUNDLED_NODE_RUNTIME" != "1" ]]; then
  echo "REQUIRE_BUNDLED_NODE_RUNTIME 只能为 0 或 1" >&2
  exit 1
fi
if [[ "$CODESIGN_IDENTITY" != "-" ]]; then
  if [[ ! "$LINGGLOW_DEVELOPER_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "正式签名必须设置 10 位 LINGGLOW_DEVELOPER_TEAM_ID，用于在应用内固定发布者 Team ID" >&2
    exit 1
  fi
fi
if [[ ! -f "$MENU_BAR_TEMPLATE" ]] || ! /usr/bin/xmllint --noout "$MENU_BAR_TEMPLATE" >/dev/null 2>&1; then
  echo "缺少或无法解析菜单栏矢量图标：$MENU_BAR_TEMPLATE" >&2
  exit 1
fi

SOURCES=("$NATIVE_DIR"/Sources/*.swift)
if [[ ! -e "${SOURCES[0]}" ]]; then
  echo "缺少 native/Sources/*.swift" >&2
  exit 1
fi

BUILD_ROOT="$(/usr/bin/mktemp -d "$NATIVE_DIR/.build.XXXXXX")"
trap '/bin/rm -rf "$BUILD_ROOT"' EXIT
STAGED_APP="$BUILD_ROOT/灵妆.app"
MACOS_DIR="$STAGED_APP/Contents/MacOS"
RESOURCES_DIR="$STAGED_APP/Contents/Resources"
BACKEND_RESOURCES_DIR="$RESOURCES_DIR/LingGlowBackend"
RELEASE_COMMERCE_CONFIG="$PROJECT_ROOT/release/commerce-public.json"
RELEASE_COMMERCE_MAX_BYTES=65536
QA_SOURCE_DIR="$PROJECT_ROOT/qa"
QA_EVIDENCE_MAX_BYTES=$((4 * 1024 * 1024))
RUNTIME_IDENTITY_FILE="runtime-identity.txt"
RUNTIME_IDENTITY_HEADER="lingglow-runtime-identity-v1"
/bin/mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
/usr/bin/install -m 0644 "$NATIVE_DIR/Info.plist" "$STAGED_APP/Contents/Info.plist"
if [[ "$CODESIGN_IDENTITY" != "-" ]]; then
  /usr/libexec/PlistBuddy -c "Add :LingGlowDeveloperTeamID string $LINGGLOW_DEVELOPER_TEAM_ID" \
    "$STAGED_APP/Contents/Info.plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :LingGlowDeveloperTeamID $LINGGLOW_DEVELOPER_TEAM_ID" \
      "$STAGED_APP/Contents/Info.plist"
fi
/usr/bin/install -m 0644 "$MENU_BAR_TEMPLATE" "$RESOURCES_DIR/LingGlowMenuBarTemplate.svg"
if [[ -f "$MENU_BAR_ICON" ]]; then
  /usr/bin/install -m 0644 "$MENU_BAR_ICON" "$RESOURCES_DIR/LingGlowMenuBarIcon.png"
fi
if [[ -d "$LOCALIZATIONS_DIR" ]]; then
  for localization in "$LOCALIZATIONS_DIR"/*.lproj; do
    [[ -d "$localization" ]] || continue
    /usr/bin/ditto "$localization" "$RESOURCES_DIR/$(basename "$localization")"
  done
fi
if [[ -f "$OPTIONAL_APP_ICON" ]]; then
  /usr/bin/install -m 0644 "$OPTIONAL_APP_ICON" "$RESOURCES_DIR/LingGlowAppIcon.icns"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string LingGlowAppIcon' "$STAGED_APP/Contents/Info.plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile LingGlowAppIcon' "$STAGED_APP/Contents/Info.plist"
fi
if [[ -f "$SHELL_BACKGROUND" ]]; then
  /usr/bin/install -m 0644 "$SHELL_BACKGROUND" "$RESOURCES_DIR/LingGlowShellBackground.webp"
fi

assert_runtime_tree_safe() {
  local source="$1"
  local label="$2"
  if [[ ! -d "$source" ]]; then
    echo "缺少运行时目录：$label" >&2
    exit 1
  fi
  if /usr/bin/find "$source" -type l -print -quit | /usr/bin/grep -q .; then
    echo "拒绝打包含符号链接的运行时目录：$label" >&2
    exit 1
  fi
}

copy_bundled_node_runtime() {
  local source_runtime="$NODE_RUNTIME_SOURCE_DIR/runtime"
  local destination="$RESOURCES_DIR/LingGlowNodeRuntime"
  if [[ ! -d "$source_runtime" ]]; then
    if [[ "$REQUIRE_BUNDLED_NODE_RUNTIME" == "1" ]]; then
      echo "正式发行缺少内置 Node 运行时。请先执行 node scripts/fetch_node_runtime.mjs --install" >&2
      exit 1
    fi
    return 0
  fi
  if [[ ! -f "$NODE_RUNTIME_SOURCE_DIR/manifest.json" || ! -f "$NODE_RUNTIME_INSTALLER" ]]; then
    echo "内置 Node 运行时缺少受审计清单或校验器" >&2
    exit 1
  fi
  "$NODE_BIN" "$NODE_RUNTIME_INSTALLER" --verify
  assert_runtime_tree_safe "$source_runtime" "bundled-node-runtime"
  /bin/mkdir -p "$destination"
  /usr/bin/install -m 0644 "$source_runtime/LICENSE" "$destination/LICENSE"
  /usr/bin/install -m 0644 "$source_runtime/runtime-lock.json" "$destination/runtime-lock.json"
  for runtime_arch in "${NODE_RUNTIME_ARCH_LIST[@]}"; do
    /bin/mkdir -p "$destination/$runtime_arch"
    /usr/bin/install -m 0755 "$source_runtime/$runtime_arch/node" "$destination/$runtime_arch/node"
  done
}

for runtime_dir in src adapters catalog public; do
  assert_runtime_tree_safe "$PROJECT_ROOT/$runtime_dir" "$runtime_dir"
done
assert_runtime_tree_safe "$QA_SOURCE_DIR" "qa"
if [[ ! -f "$PROJECT_ROOT/start.command" || -L "$PROJECT_ROOT/start.command" ]]; then
  echo "缺少安全的 start.command" >&2
  exit 1
fi
if [[ ! -f "$PROJECT_ROOT/package.json" || -L "$PROJECT_ROOT/package.json" ]]; then
  echo "缺少安全的 package.json" >&2
  exit 1
fi
if [[ ! -f "$THIRD_PARTY_NOTICES_SOURCE" || -L "$THIRD_PARTY_NOTICES_SOURCE" ]]; then
  echo "缺少安全的第三方软件声明：$THIRD_PARTY_NOTICES_SOURCE" >&2
  exit 1
fi

/bin/mkdir -p "$BACKEND_RESOURCES_DIR"
/usr/bin/install -m 0644 "$PROJECT_ROOT/start.command" "$BACKEND_RESOURCES_DIR/start.command"
/usr/bin/install -m 0644 "$PROJECT_ROOT/package.json" "$BACKEND_RESOURCES_DIR/package.json"
/usr/bin/install -m 0444 "$THIRD_PARTY_NOTICES_SOURCE" \
  "$BACKEND_RESOURCES_DIR/THIRD_PARTY_NOTICES.md"
for runtime_dir in src adapters catalog public; do
  /usr/bin/ditto --noextattr --noqtn \
    "$PROJECT_ROOT/$runtime_dir" \
    "$BACKEND_RESOURCES_DIR/$runtime_dir"
done
"$NODE_BIN" "$PROJECT_ROOT/scripts/build_skin_distribution.mjs" \
  --prune-runtime "$BACKEND_RESOURCES_DIR/catalog" \
  --keep aurora-free \
  --keep cr7-portugal \
  --keep kungfu-womens-football
copy_bundled_node_runtime

# Runtime Theme Packs need the optimized assets and final definitions, not the
# authoring PNGs or test fixtures. Both paths are inside the fresh staging tree.
/bin/rm -rf \
  "$BACKEND_RESOURCES_DIR/catalog/source-art" \
  "$BACKEND_RESOURCES_DIR/catalog/theme-packs/fixtures"

# Adapter validation needs only bounded, machine-readable evidence. Keep the
# directory structure because adapter evidence paths may be `qa/release/...`,
# but never copy visual QA screenshots or any other non-JSON source asset.
# `assert_runtime_tree_safe` above already rejects a symlink anywhere in qa.
/bin/mkdir -p "$BACKEND_RESOURCES_DIR/qa"
qa_evidence_count=0
while IFS= read -r -d '' qa_file; do
  qa_relative="${qa_file#"$QA_SOURCE_DIR"/}"
  if [[ "$qa_relative" == "$qa_file" ]] || [[ ! "$qa_relative" =~ ^[A-Za-z0-9._/-]+\.json$ ]] || \
     [[ ! -f "$qa_file" ]] || [[ -L "$qa_file" ]]; then
    echo "拒绝打包不安全的 QA 证据：$qa_relative" >&2
    exit 1
  fi
  IFS='/' read -r -a qa_segments <<< "$qa_relative"
  for qa_segment in "${qa_segments[@]}"; do
    if [[ ! "$qa_segment" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$qa_segment" == "." ]] || [[ "$qa_segment" == ".." ]]; then
      echo "拒绝打包不安全的 QA 证据路径：$qa_relative" >&2
      exit 1
    fi
  done
  qa_links="$(/usr/bin/stat -f '%l' "$qa_file")"
  qa_size="$(/usr/bin/stat -f '%z' "$qa_file")"
  if [[ "$qa_links" != "1" ]] || [[ ! "$qa_size" =~ ^[0-9]+$ ]] || \
     (( qa_size < 1 || qa_size > QA_EVIDENCE_MAX_BYTES )); then
    echo "QA 证据必须是单链接且大小在 1 到 $QA_EVIDENCE_MAX_BYTES 字节之间：$qa_relative" >&2
    exit 1
  fi
  qa_destination="$BACKEND_RESOURCES_DIR/qa/$qa_relative"
  /bin/mkdir -p "$(/usr/bin/dirname "$qa_destination")"
  /usr/bin/install -m 0644 "$qa_file" "$qa_destination"
  qa_evidence_count=$((qa_evidence_count + 1))
done < <(/usr/bin/find "$QA_SOURCE_DIR" -type f -name '*.json' -print0)
if (( qa_evidence_count < 1 )); then
  echo "缺少可打包的 QA JSON 证据" >&2
  exit 1
fi

if [[ -e "$RELEASE_COMMERCE_CONFIG" || -L "$RELEASE_COMMERCE_CONFIG" ]]; then
  if [[ -L "$RELEASE_COMMERCE_CONFIG" || ! -f "$RELEASE_COMMERCE_CONFIG" ]]; then
    echo "拒绝打包不安全的发行商业配置：$RELEASE_COMMERCE_CONFIG" >&2
    exit 1
  fi
  release_commerce_size="$(/usr/bin/stat -f '%z' "$RELEASE_COMMERCE_CONFIG")"
  if [[ ! "$release_commerce_size" =~ ^[0-9]+$ ]] || \
     (( release_commerce_size < 1 || release_commerce_size > RELEASE_COMMERCE_MAX_BYTES )); then
    echo "发行商业配置大小必须在 1 到 $RELEASE_COMMERCE_MAX_BYTES 字节之间" >&2
    exit 1
  fi
  /bin/mkdir -p "$BACKEND_RESOURCES_DIR/release"
  /usr/bin/install -m 0644 "$RELEASE_COMMERCE_CONFIG" \
    "$BACKEND_RESOURCES_DIR/release/commerce-public.json"
fi

# A native menu-bar build may intentionally leave a backend alive after its UI
# exits so an active skin session is not torn down.  Make the backend's exact
# signed resource set explicit: the Swift launcher verifies this manifest and
# passes its SHA-256 into the backend, which records it in both the private
# session lock and /api/status. A newer app therefore cannot attach to an old
# schema/catalog process by accident.
build_runtime_identity() {
  local body="$BUILD_ROOT/runtime-identity-body.txt"
  local temporary="$BACKEND_RESOURCES_DIR/.${RUNTIME_IDENTITY_FILE}.tmp"
  local identity=""
  (
    cd "$BACKEND_RESOURCES_DIR"
    LC_ALL=C /usr/bin/find . -type f ! -path "./$RUNTIME_IDENTITY_FILE" -print |
      LC_ALL=C /usr/bin/sort |
      while IFS= read -r entry; do
        local_relative="${entry#./}"
        if [[ ! "$local_relative" =~ ^[A-Za-z0-9._/-]+$ ]] || \
           [[ "$local_relative" == */../* || "$local_relative" == ../* || "$local_relative" == */.. || \
              "$local_relative" == */./* || "$local_relative" == ./* || "$local_relative" == */. ]]; then
          echo "运行时身份清单遇到不安全路径：$local_relative" >&2
          exit 1
        fi
        file_hash="$(/usr/bin/shasum -a 256 "$entry" | /usr/bin/awk '{print $1}')"
        if [[ ! "$file_hash" =~ ^[a-f0-9]{64}$ ]]; then
          echo "无法计算运行时文件摘要：$local_relative" >&2
          exit 1
        fi
        printf '%s  %s\n' "$file_hash" "$local_relative"
      done
  ) > "$body"
  if [[ ! -s "$body" ]]; then
    echo "运行时身份清单不能为空" >&2
    exit 1
  fi
  identity="$(/usr/bin/shasum -a 256 "$body" | /usr/bin/awk '{print $1}')"
  if [[ ! "$identity" =~ ^[a-f0-9]{64}$ ]]; then
    echo "无法计算运行时身份摘要" >&2
    exit 1
  fi
  {
    printf '%s\n%s\n' "$RUNTIME_IDENTITY_HEADER" "$identity"
    /bin/cat "$body"
  } > "$temporary"
  /bin/chmod 0644 "$temporary"
  /bin/mv "$temporary" "$BACKEND_RESOURCES_DIR/$RUNTIME_IDENTITY_FILE"
}

build_runtime_identity
if /usr/bin/find "$BACKEND_RESOURCES_DIR" -type l -print -quit | /usr/bin/grep -q .; then
  echo "运行时资源暂存后出现符号链接，已拒绝签名" >&2
  exit 1
fi
/usr/bin/find "$BACKEND_RESOURCES_DIR" -type d -exec /bin/chmod 0755 {} +
/usr/bin/find "$BACKEND_RESOURCES_DIR" -type f -exec /bin/chmod 0644 {} +
/bin/chmod 0444 "$BACKEND_RESOURCES_DIR/THIRD_PARTY_NOTICES.md"

BINARIES=()
for arch in $ARCHS; do
  case "$arch" in
    arm64|x86_64) ;;
    *)
      echo "不支持的 ARCHS 值：$arch" >&2
      exit 1
      ;;
  esac
  binary="$BUILD_ROOT/$EXECUTABLE_NAME.$arch"
  "$SWIFTC" \
    -swift-version 5 \
    -parse-as-library \
    -whole-module-optimization \
    -O \
    -sdk "$SDKROOT" \
    -module-cache-path "$BUILD_ROOT/ModuleCache.$arch" \
    -target "${arch}-apple-macosx${DEPLOYMENT_TARGET}" \
    -framework AppKit \
    -framework SwiftUI \
    -framework Combine \
    "${SOURCES[@]}" \
    -o "$binary"
  BINARIES+=("$binary")
done

if [[ "${#BINARIES[@]}" -eq 1 ]]; then
  /usr/bin/install -m 0755 "${BINARIES[0]}" "$MACOS_DIR/$EXECUTABLE_NAME"
else
  /usr/bin/lipo -create "${BINARIES[@]}" -output "$MACOS_DIR/$EXECUTABLE_NAME"
  /bin/chmod 0755 "$MACOS_DIR/$EXECUTABLE_NAME"
fi

if [[ "$CODESIGN_IDENTITY" == "-" ]]; then
  /usr/bin/codesign --force --sign - --timestamp=none "$STAGED_APP"
else
  /usr/bin/codesign --force --sign "$CODESIGN_IDENTITY" --options runtime --timestamp "$STAGED_APP"
fi
/usr/bin/codesign --verify --deep --strict "$STAGED_APP"

if [[ -L "$OUTPUT_APP" ]]; then
  echo "拒绝覆盖符号链接：$OUTPUT_APP" >&2
  exit 1
fi
if [[ -e "$OUTPUT_APP" ]]; then
  existing_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$OUTPUT_APP/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$existing_id" != "$BUNDLE_ID" ]]; then
    echo "拒绝覆盖非灵妆原生包：$OUTPUT_APP" >&2
    exit 1
  fi
  /bin/rm -rf "$OUTPUT_APP"
fi
/bin/mv "$STAGED_APP" "$OUTPUT_APP"

if [[ "$LEGACY_OUTPUT_APP" != "$OUTPUT_APP" && -e "$LEGACY_OUTPUT_APP" ]]; then
  if [[ -L "$LEGACY_OUTPUT_APP" ]]; then
    echo "检测到旧版应用路径为符号链接，未自动删除：$LEGACY_OUTPUT_APP" >&2
  else
    legacy_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LEGACY_OUTPUT_APP/Contents/Info.plist" 2>/dev/null || true)"
    if [[ "$legacy_id" == "$BUNDLE_ID" ]]; then
      /bin/rm -rf "$LEGACY_OUTPUT_APP"
    else
      echo "旧版应用路径不属于灵妆，已保留：$LEGACY_OUTPUT_APP" >&2
    fi
  fi
fi

if [[ -e "$LEGACY_LAUNCHER_APP" ]]; then
  if [[ -L "$LEGACY_LAUNCHER_APP" ]]; then
    echo "检测到旧启动器为符号链接，未自动删除：$LEGACY_LAUNCHER_APP" >&2
  else
    launcher_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LEGACY_LAUNCHER_APP/Contents/Info.plist" 2>/dev/null || true)"
    if [[ "$launcher_id" == "local.skin-studio.launcher" ]]; then
      /bin/rm -rf "$LEGACY_LAUNCHER_APP"
    else
      echo "旧启动器路径不属于灵妆，已保留：$LEGACY_LAUNCHER_APP" >&2
    fi
  fi
fi

echo "已构建：$OUTPUT_APP"

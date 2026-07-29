#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_PNG="${1:-$PROJECT_ROOT/native/Resources/LingGlowAppIcon-1024.png}"
OUTPUT_ICNS="${2:-$PROJECT_ROOT/native/Resources/LingGlowAppIcon.icns}"
DEFAULT_SOURCE_PNG="$PROJECT_ROOT/native/Resources/LingGlowAppIcon-1024.png"
ARTWORK_PNG="$PROJECT_ROOT/native/Resources/LingGlowAppIcon-Artwork-1024.png"

if [[ "$SOURCE_PNG" == "$DEFAULT_SOURCE_PNG" ]]; then
  if [[ ! -f "$ARTWORK_PNG" ]] || [[ -L "$ARTWORK_PNG" ]]; then
    echo "缺少安全的应用图标原始图片：$ARTWORK_PNG" >&2
    exit 1
  fi
  /usr/bin/xcrun swift "$PROJECT_ROOT/scripts/build_app_icon_source.swift" "$ARTWORK_PNG" "$SOURCE_PNG"
fi

if [[ ! -f "$SOURCE_PNG" ]] || [[ -L "$SOURCE_PNG" ]]; then
  echo "缺少安全的 1024×1024 应用图标 PNG：$SOURCE_PNG" >&2
  exit 1
fi

WIDTH="$(/usr/bin/sips -g pixelWidth "$SOURCE_PNG" 2>/dev/null | /usr/bin/awk '/pixelWidth/ {print $2}')"
HEIGHT="$(/usr/bin/sips -g pixelHeight "$SOURCE_PNG" 2>/dev/null | /usr/bin/awk '/pixelHeight/ {print $2}')"
FORMAT="$(/usr/bin/sips -g format "$SOURCE_PNG" 2>/dev/null | /usr/bin/awk '/format/ {print $2}')"
HAS_ALPHA="$(/usr/bin/sips -g hasAlpha "$SOURCE_PNG" 2>/dev/null | /usr/bin/awk '/hasAlpha/ {print $2}')"
if [[ "$WIDTH" != "1024" || "$HEIGHT" != "1024" || "$FORMAT" != "png" || "$HAS_ALPHA" != "yes" ]]; then
  echo "应用图标必须是带真实透明通道的 1024×1024 PNG" >&2
  exit 1
fi

BUILD_ROOT="$(/usr/bin/mktemp -d "$PROJECT_ROOT/native/.icon-build.XXXXXX")"
trap '/bin/rm -rf "$BUILD_ROOT"' EXIT
ICONSET="$BUILD_ROOT/LingGlowAppIcon.iconset"
/bin/mkdir -p "$ICONSET"
PACKED_ICNS="$BUILD_ROOT/LingGlowAppIcon.icns"
VERIFY_ICONSET="$BUILD_ROOT/verify.iconset"

make_icon() {
  local size="$1"
  local name="$2"
  /usr/bin/sips -z "$size" "$size" "$SOURCE_PNG" --out "$ICONSET/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
/usr/bin/install -m 0644 "$SOURCE_PNG" "$ICONSET/icon_512x512@2x.png"

if [[ -L "$OUTPUT_ICNS" ]]; then
  echo "拒绝覆盖符号链接：$OUTPUT_ICNS" >&2
  exit 1
fi
if ! /usr/bin/env node "$PROJECT_ROOT/scripts/write_icns.mjs" "$ICONSET" "$PACKED_ICNS"; then
  trap - EXIT
  echo "ICNS 打包失败，调试文件已保留：$ICONSET" >&2
  exit 1
fi

# macOS 27 的 iconutil 无法稳定地从 iconset 直接打包；反向解包仍可作为系统级校验。
if ! /usr/bin/iconutil -c iconset "$PACKED_ICNS" -o "$VERIFY_ICONSET"; then
  trap - EXIT
  echo "系统无法读取生成的 ICNS，调试文件已保留：$BUILD_ROOT" >&2
  exit 1
fi

OUTPUT_TMP="$OUTPUT_ICNS.tmp.$$"
if [[ -e "$OUTPUT_TMP" || -L "$OUTPUT_TMP" ]]; then
  echo "拒绝覆盖临时输出：$OUTPUT_TMP" >&2
  exit 1
fi
/usr/bin/install -m 0644 "$PACKED_ICNS" "$OUTPUT_TMP"
/bin/mv -f "$OUTPUT_TMP" "$OUTPUT_ICNS"
echo "已生成：$OUTPUT_ICNS"

#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP="$PROJECT_ROOT/灵妆.app"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/dist}"
IDENTITY="${CODESIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARYTOOL_PROFILE:-}"
NOTARY_KEY="${NOTARYTOOL_KEY:-}"
NOTARY_KEY_ID="${NOTARYTOOL_KEY_ID:-}"
NOTARY_ISSUER="${NOTARYTOOL_ISSUER:-}"
EXPECTED_TEAM_ID="${LINGGLOW_DEVELOPER_TEAM_ID:-}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PROJECT_ROOT/native/Info.plist")"
ARTIFACT_SUFFIX="${ARTIFACT_SUFFIX:-}"
ARTIFACT_LABEL="${ARTIFACT_SUFFIX:+-$ARTIFACT_SUFFIX}"
ARCHIVE="$OUTPUT_DIR/LingGlow-${VERSION}-macOS${ARTIFACT_LABEL}.zip"
DMG="$OUTPUT_DIR/LingGlow-${VERSION}-macOS${ARTIFACT_LABEL}.dmg"
DMG_STAGE=""

cleanup() {
  if [[ -n "$DMG_STAGE" && -d "$DMG_STAGE" ]]; then
    /bin/rm -rf "$DMG_STAGE"
  fi
}
trap cleanup EXIT

if [[ -z "$IDENTITY" || "$IDENTITY" == "-" ]]; then
  echo "正式发行必须设置 CODESIGN_IDENTITY=Developer ID Application: ..." >&2
  exit 1
fi
if [[ "$IDENTITY" != Developer\ ID\ Application:* ]]; then
  echo "CODESIGN_IDENTITY 必须是 Developer ID Application 证书" >&2
  exit 1
fi
NOTARY_ARGS=()
if [[ -n "$NOTARY_PROFILE" ]]; then
  NOTARY_ARGS=(--keychain-profile "$NOTARY_PROFILE")
elif [[ -n "$NOTARY_KEY" && -n "$NOTARY_KEY_ID" && -n "$NOTARY_ISSUER" ]]; then
  NOTARY_ARGS=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
else
  echo "正式发行必须设置 NOTARYTOOL_PROFILE，或完整设置 NOTARYTOOL_KEY / NOTARYTOOL_KEY_ID / NOTARYTOOL_ISSUER" >&2
  exit 1
fi
# Apple's accelerated S3 endpoint can leave an otherwise valid notarization
# submission stuck in multipart upload on some networks.  The standard S3
# endpoint is slower but deterministic; an operator may explicitly opt back in
# only after validating the current network path.
NOTARY_TRANSFER_ARGS=(--no-s3-acceleration)
if [[ "${NOTARYTOOL_S3_ACCELERATION:-0}" == "1" ]]; then
  NOTARY_TRANSFER_ARGS=(--s3-acceleration)
fi
if [[ ! "$EXPECTED_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "正式发行必须设置 10 位 LINGGLOW_DEVELOPER_TEAM_ID，以固定灵妆发布者身份" >&2
  exit 1
fi

export CODESIGN_IDENTITY="$IDENTITY"
export LINGGLOW_DEVELOPER_TEAM_ID="$EXPECTED_TEAM_ID"
export REQUIRE_BUNDLED_NODE_RUNTIME=1
# A C-end release must not inherit the architecture of the machine that
# happened to create it.  Local development builds may stay single-arch, but
# the notarized distribution defaults to one Universal 2 application for both
# supported macOS CPU families.  A release engineer can still set ARCHS
# explicitly for an intentionally constrained build.
export ARCHS="${ARCHS:-arm64 x86_64}"
export NODE_RUNTIME_ARCHS="${NODE_RUNTIME_ARCHS:-$ARCHS}"
"$SCRIPT_DIR/build_native.sh"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP"
ACTUAL_TEAM_ID="$(/usr/bin/codesign -dv --verbose=4 "$APP" 2>&1 | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}')"
if [[ "$ACTUAL_TEAM_ID" != "$EXPECTED_TEAM_ID" ]]; then
  echo "签名 Team ID 与 LINGGLOW_DEVELOPER_TEAM_ID 不匹配，拒绝发行" >&2
  exit 1
fi

/bin/mkdir -p "$OUTPUT_DIR"
if [[ -L "$OUTPUT_DIR" ]]; then
  echo "拒绝向符号链接输出目录写入" >&2
  exit 1
fi
/bin/rm -f "$ARCHIVE"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
/usr/bin/xcrun notarytool submit "$ARCHIVE" "${NOTARY_ARGS[@]}" "${NOTARY_TRANSFER_ARGS[@]}" --wait
/usr/bin/xcrun stapler staple "$APP"
/usr/bin/xcrun stapler validate "$APP"
/usr/sbin/spctl --assess --type execute --verbose=2 "$APP"

/bin/rm -f "$ARCHIVE"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
/usr/bin/codesign --verify --deep --strict "$APP"

DMG_STAGE="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/lingglow-dmg.XXXXXX")"
/usr/bin/ditto "$APP" "$DMG_STAGE/灵妆.app"
/bin/ln -s /Applications "$DMG_STAGE/Applications"
/bin/rm -f "$DMG"
/usr/bin/hdiutil create \
  -volname "LingGlow ${VERSION}" \
  -srcfolder "$DMG_STAGE" \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG"
/usr/bin/codesign --force --timestamp --sign "$IDENTITY" "$DMG"
/usr/bin/codesign --verify --verbose=2 "$DMG"
/usr/bin/xcrun notarytool submit "$DMG" "${NOTARY_ARGS[@]}" "${NOTARY_TRANSFER_ARGS[@]}" --wait
/usr/bin/xcrun stapler staple "$DMG"
/usr/bin/xcrun stapler validate "$DMG"
/usr/sbin/spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

echo "已生成并公证：$ARCHIVE"
echo "已生成、签名并公证：$DMG"

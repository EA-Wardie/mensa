#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this script only installs mensa on macOS (detected $(uname -s))." >&2
  exit 1
fi

# uname -m reports x86_64 under Rosetta, so ask the hardware.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null)" != "1" ]]; then
  echo "error: this script only installs mensa on Apple silicon (detected $(uname -m))." >&2
  exit 1
fi

APP_SRC="$SCRIPT_DIR/Mensa.app"
APPS_DIR="$HOME/Applications"
APP_DEST="$APPS_DIR/Mensa.app"
APP_BIN="$APP_DEST/Contents/MacOS/Mensa"
BIN_DIR="$HOME/.local/bin"
BIN_DEST="$BIN_DIR/mensa"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ ! -d "$APP_SRC" ]]; then
  echo "error: $APP_SRC not found. Run 'bun run build' if building from source, or re-extract the release archive." >&2
  exit 1
fi

mkdir -p "$APPS_DIR" "$BIN_DIR"

# Copy beside the old bundle and swap it in, so upgrading works while mensa is running.
APP_TMP="$(mktemp -d "$APPS_DIR/.Mensa.XXXXXX")"
trap 'rm -rf "$APP_TMP"' EXIT

ditto "$APP_SRC" "$APP_TMP/Mensa.app"

# macOS refuses to open a downloaded app until the quarantine attribute is removed.
xattr -dr com.apple.quarantine "$APP_TMP/Mensa.app" 2>/dev/null || true

# Apple silicon only runs signed code, so give the binary an ad-hoc signature.
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$APP_TMP/Mensa.app/Contents/MacOS/Mensa" 2>/dev/null || echo "warning: codesign failed, macOS may refuse to run mensa." >&2
fi

# Move the old bundle aside rather than deleting it, so a failed move can put it back.
# The trap deletes it with the temp folder.
if [[ -e "$APP_DEST" ]]; then
  mv "$APP_DEST" "$APP_TMP/Mensa.old.app"
fi

if ! mv "$APP_TMP/Mensa.app" "$APP_DEST"; then
  if [[ -e "$APP_TMP/Mensa.old.app" ]]; then
    mv "$APP_TMP/Mensa.old.app" "$APP_DEST"
  fi
  echo "error: could not move Mensa.app into $APPS_DIR, the previous install was kept." >&2
  exit 1
fi

# Register the app now, so Spotlight finds it and shows its icon straight away.
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$APP_DEST" || echo "warning: lsregister failed, Spotlight may take a while to find Mensa." >&2
fi

# Replaces the copied binary of an older install too.
ln -sfn "$APP_BIN" "$BIN_DEST"

echo "Installed $APP_DEST and linked $BIN_DEST"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "warning: $BIN_DIR is not on your PATH. Add it to your shell profile to run 'mensa' directly." ;;
esac

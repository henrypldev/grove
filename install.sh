#!/bin/bash
set -euo pipefail

INSTALL_DIR="$HOME/.grove/bin"
REPO="henrypldev/grove"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

error() {
  echo -e "${RED}error:${RESET} $1" >&2
  exit 1
}

# 1. Verify macOS
OS="$(uname -s)"
if [ "$OS" != "Darwin" ]; then
  error "grove is only supported on macOS (got $OS)"
fi

# 2. Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) TARGET="darwin-arm64" ;;
  x86_64)        TARGET="darwin-x64" ;;
  *)             error "unsupported architecture: $ARCH" ;;
esac

# 3. Fetch latest release version
echo "Fetching latest grove release..."
VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/')"
if [ -z "$VERSION" ]; then
  error "failed to fetch latest release version"
fi

# 4. Download tarball
TARBALL="grove-${VERSION}-${TARGET}.tar.gz"
URL="https://github.com/$REPO/releases/download/v${VERSION}/${TARBALL}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Downloading grove v${VERSION} for ${TARGET}..."
curl -fsSL "$URL" -o "$WORK_DIR/$TARBALL" || error "failed to download $URL"

# 5. Extract to ~/.grove/bin/
mkdir -p "$INSTALL_DIR"
tar -xzf "$WORK_DIR/$TARBALL" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/grove"

# 6. Add to PATH
add_to_path() {
  local rcfile="$1"
  local line='export PATH="$HOME/.grove/bin:$PATH"'
  if [ -f "$rcfile" ] && grep -qF '.grove/bin' "$rcfile"; then
    return
  fi
  touch "$rcfile"
  printf '\n# grove\n%s\n' "$line" >> "$rcfile"
  echo "  Added grove to PATH in $(basename "$rcfile")"
}

SHELL_NAME="${SHELL##*/}"
case "$SHELL_NAME" in
  zsh)  RCFILE="$HOME/.zshrc" ;;
  bash) RCFILE="$HOME/.bashrc" ;;
  *)    RCFILE="$HOME/.profile" ;;
esac
add_to_path "$RCFILE"

# 7. Success
echo ""
echo -e "${GREEN}${BOLD}grove v${VERSION}${RESET} installed to ${INSTALL_DIR}"
echo ""
echo "Restart your shell or run:"
echo "  source $RCFILE"
echo ""
echo "Then get started with:"
echo "  grove start"

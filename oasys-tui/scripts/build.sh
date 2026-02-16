#!/usr/bin/env bash
# Build standalone oasys executable(s).
# Run from repo root: ./scripts/build.sh
#
# Usage:
#   ./scripts/build.sh              Build for current platform only (for local dev).
#   BUILD_TARGET=linux-x64 ./scripts/build.sh   Build one target (used by CI per-platform jobs).
#   BUILD_TARGET=all ./scripts/build.sh         Build all targets (requires all @opentui/core-* deps).
#
# Output: dist/oasys-<target>.zip (or multiple zips when BUILD_TARGET=all).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"
ENTRY="${ENTRY:-$ROOT_DIR/src/index.tsx}"

cd "$ROOT_DIR"

VERSION="${VERSION:-$(git describe --tags --always 2>/dev/null || echo "dev")}"
echo "Building oasys $VERSION"

mkdir -p "$DIST_DIR"

# Create .zip from binary (works on Linux, macOS, and Windows where zip may be missing)
zip_binary() {
  local out_binary="$1"
  local artifact_name="$2"
  local zip_path="$DIST_DIR/$artifact_name.zip"
  local bin_path="$DIST_DIR/$out_binary"

  if command -v zip &>/dev/null; then
    zip -j "$zip_path" "$bin_path"
  elif [[ "$(uname -s)" =~ ^MINGW ]] || [[ "$(uname -s)" =~ ^MSYS ]] || [[ -n "${OS:-}" && "$OS" == "Windows_NT" ]]; then
    # Windows (Git Bash): use PowerShell
    powershell.exe -NoProfile -Command "Compress-Archive -Path 'dist/$out_binary' -DestinationPath 'dist/$artifact_name.zip' -Force"
  else
    echo "error: zip not found and not on Windows" >&2
    exit 127
  fi
  rm -f "$bin_path"
}

# Map: our target name -> (bun target, output binary name)
build_one() {
  local bun_target="$1"
  local artifact_name="$2"
  local out_binary="$3"

  echo "  Building $bun_target -> $artifact_name"
  bun build "$ENTRY" \
    --compile \
    --target="$bun_target" \
    --outfile="$DIST_DIR/$out_binary" \
    --define "OASYS_VERSION=\"$VERSION\""

  if [[ -f "$DIST_DIR/$out_binary" ]]; then
    zip_binary "$out_binary" "$artifact_name"
  fi
}

# Detect current platform for default BUILD_TARGET (no cross-compile)
detect_platform() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
  esac
  if [[ "$os" == "darwin" ]]; then
    echo "darwin-$arch"
  elif [[ "$os" == "linux" ]]; then
    echo "linux-$arch"
  elif [[ "$os" == "mingw"* ]] || [[ "${OS:-}" == "Windows_NT" ]]; then
    echo "windows-x64"
  else
    echo "linux-x64"
  fi
}

# Resolve what to build
TARGET="${BUILD_TARGET:-$(detect_platform)}"

case "$TARGET" in
  darwin-arm64)
    build_one "bun-darwin-arm64" "oasys-darwin-arm64" "oasys-darwin-arm64"
    ;;
  darwin-x64)
    build_one "bun-darwin-x64" "oasys-darwin-x64" "oasys-darwin-x64"
    ;;
  linux-x64)
    build_one "bun-linux-x64" "oasys-linux-x64" "oasys-linux-x64"
    ;;
  linux-arm64)
    build_one "bun-linux-arm64" "oasys-linux-arm64" "oasys-linux-arm64"
    ;;
  windows-x64)
    build_one "bun-windows-x64" "oasys-windows-x64" "oasys-windows-x64.exe"
    ;;
  all)
    build_one "bun-darwin-arm64"  "oasys-darwin-arm64"  "oasys-darwin-arm64"
    build_one "bun-darwin-x64"    "oasys-darwin-x64"    "oasys-darwin-x64"
    build_one "bun-linux-x64"     "oasys-linux-x64"     "oasys-linux-x64"
    build_one "bun-linux-arm64"   "oasys-linux-arm64"  "oasys-linux-arm64"
    build_one "bun-windows-x64"   "oasys-windows-x64"   "oasys-windows-x64.exe"
    ;;
  *)
    echo "Unknown BUILD_TARGET: $TARGET" >&2
    echo "Use one of: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, all" >&2
    exit 1
    ;;
esac

echo "Done. Artifacts in $DIST_DIR:"
ls -la "$DIST_DIR"/*.zip 2>/dev/null || true

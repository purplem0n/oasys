#!/usr/bin/env bash
# Install oasys CLI from GitHub Releases.
# Usage: curl -fsSL https://raw.githubusercontent.com/purplem0n/oasys/main/oasys-tui/install.sh | bash
#    or: curl -fsSL https://your-domain.com/install | bash
#
# Override: OASYS_INSTALL_DIR (default: ~/.local/bin), GITHUB_REPO (default: purplem0n/oasys)

set -euo pipefail

# Default GitHub repo
GITHUB_REPO="${GITHUB_REPO:-purplem0n/oasys}"
GITHUB="${GITHUB:-https://github.com}"
BASE_URL="$GITHUB/$GITHUB_REPO/releases"

# Colors
Color_Off=''
Red=''
Green=''
Dim=''
Bold_White=''
Bold_Green=''
if [[ -t 1 ]]; then
  Color_Off='\033[0m'
  Red='\033[0;31m'
  Green='\033[0;32m'
  Dim='\033[0;2m'
  Bold_White='\033[1m'
  Bold_Green='\033[1;32m'
fi

error() { echo -e "${Red}error${Color_Off}: $*" >&2; exit 1; }
info() { echo -e "${Dim}$*${Color_Off}"; }
success() { echo -e "${Green}$*${Color_Off}"; }

# Detect platform (same style as Bun install script)
platform=$(uname -ms)

case $platform in
  Darwin\ x86_64)   target=darwin-x64 ;;
  Darwin\ arm64)    target=darwin-arm64 ;;
  Linux\ aarch64|Linux\ arm64) target=linux-arm64 ;;
  Linux\ x86_64|*)  target=linux-x64 ;;
esac

# Rosetta on macOS: prefer arm64 binary
if [[ $target = darwin-x64 ]]; then
  if [[ $(sysctl -n sysctl.proc_translated 2>/dev/null) = 1 ]]; then
    target=darwin-arm64
    info "Running under Rosetta 2, installing oasys for darwin-arm64."
  fi
fi

# Windows: suggest manual download or WSL
if [[ ${OS:-} = Windows_NT ]] && [[ $platform = MINGW* ]]; then
  target=windows-x64
  info "Windows detected. Downloading windows-x64 build."
  info "Alternatively download the zip from: $BASE_URL/latest"
fi

ARCHIVE="oasys-$target.zip"
DOWNLOAD_URL="$BASE_URL/latest/download/$ARCHIVE"

# Allow installing a specific version: curl ... install.sh | bash -s -- v1.0.0
if [[ ${1:-} =~ ^v[0-9] ]]; then
  DOWNLOAD_URL="$GITHUB/$GITHUB_REPO/releases/download/$1/$ARCHIVE"
  info "Installing version $1"
fi

# Install directory: prefer explicit dir, else existing oasys location (update in place), else default
tildify_early() { if [[ -n "${HOME:-}" && $1 = "$HOME"/* ]]; then echo "~/${1#${HOME}/}"; else echo "$1"; fi; }
if [[ -n "${OASYS_INSTALL_DIR:-}" ]]; then
  install_dir="$OASYS_INSTALL_DIR"
else
  existing_oasys=$(command -v oasys 2>/dev/null || true)
  if [[ -n "$existing_oasys" ]]; then
    install_dir=$(dirname "$existing_oasys")
    info "Detected existing oasys at $(tildify_early "$existing_oasys"); will update in place."
  else
    install_dir="${HOME:-~}/.local/bin"
  fi
fi
bin_dir="$install_dir"
exe="$bin_dir/oasys"
[[ $target = windows-x64 ]] && exe="$bin_dir/oasys.exe"

mkdir -p "$bin_dir" || error "Failed to create $bin_dir"

# Download
info "Downloading oasys for $target..."
curl --fail --location --progress-bar --output "$exe.zip" "$DOWNLOAD_URL" \
  || error "Download failed. Check $BASE_URL for available releases."

# Unzip: zip contains a single file (oasys-darwin-arm64 or oasys-windows-x64.exe)
if [[ $target = windows-x64 ]]; then
  unzip -oqd "$bin_dir" "$exe.zip" || error "Failed to extract."
  extracted="$bin_dir/oasys-windows-x64.exe"
  [[ -f "$extracted" ]] && mv -f "$extracted" "$exe"
else
  unzip -oqd "$bin_dir" "$exe.zip" || error "Failed to extract."
  extracted="$bin_dir/oasys-$target"
  [[ -f "$extracted" ]] && mv -f "$extracted" "$exe"
fi

chmod +x "$exe" || error "Failed to chmod $exe"
rm -f "$exe.zip"

# Tildify for display
tildify() {
  if [[ $1 = $HOME/* ]]; then echo "${1/$HOME\//\~/}"; else echo "$1"; fi
}

success "oasys was installed successfully to $Bold_Green$(tildify "$exe")"

if command -v oasys >/dev/null 2>&1; then
  info "Run \`oasys\` to start."
  exit 0
fi

# Suggest adding to PATH
echo
info "Add oasys to your PATH:"
echo -e "  ${Bold_White}export PATH=\"$(tildify "$bin_dir"):\$PATH\"${Color_Off}"
echo
info "Or add the line above to your shell config (~/.zshrc, ~/.bashrc, etc.)."

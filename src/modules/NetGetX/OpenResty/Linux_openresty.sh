#!/usr/bin/env bash
set -euo pipefail

VERSION="1.27.1.1"
TARBALL="openresty-${VERSION}.tar.gz"
DOWNLOAD_URL="https://openresty.org/download/${TARBALL}"

install_prereqs_debian() {
  echo "Installing dependencies for Debian/Ubuntu..."
#   apt-get update -y
#   apt-get install -y build-essential curl perl libpcre3-dev libssl-dev zlib1g-dev
}

install_prereqs_redhat() {
  echo "Installing dependencies for RHEL/CentOS/Fedora..."
  yum install -y gcc make curl perl pcre-devel openssl-devel zlib-devel
}

install_prereqs_macos() {
  echo "Installing dependencies for macOS (Homebrew required)..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  echo "Installing OpenResty via Homebrew..."
  brew tap openresty/brew
  brew install openresty
  echo "OpenResty installed via Homebrew successfully."
}

download_and_extract() {
  echo "Downloading OpenResty ${VERSION} from ${DOWNLOAD_URL}..."
  curl -fSL "${DOWNLOAD_URL}" -o "${TARBALL}"

  echo "Extracting ${TARBALL}..."
  tar -xzf "${TARBALL}"
}

build_and_install() {
  DIR="openresty-${VERSION}"
  cd "${DIR}"

  echo "Configuring build..."
  ./configure -j2

  echo "Compiling..."
  make -j2

  echo "Installing..."
  make install

  echo "Temporarily adding OpenResty to PATH..."
  export PATH=/usr/local/openresty/bin:$PATH

  echo "✅ OpenResty ${VERSION} installed successfully."
}

main() {
  if [[ $(id -u) -ne 0 && "$OSTYPE" != "darwin"* ]]; then
    echo "Please run as root or with sudo."
    exit 1
  fi

  echo "Detecting operating system..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected macOS."
    install_prereqs_macos
    exit 0
  elif [ -f /etc/debian_version ]; then
    echo "Detected Debian/Ubuntu."
    install_prereqs_debian
  elif [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then
    echo "Detected RHEL/CentOS/Fedora."
    install_prereqs_redhat
  else
    echo "Unsupported OS. Please install manually."
    exit 1
  fi

  download_and_extract
  build_and_install

  echo ""
  echo "Add this to your ~/.bashrc or ~/.zshrc to keep OpenResty in your PATH:"
  echo "  export PATH=/usr/local/openresty/bin:\$PATH"
  echo ""
}

main

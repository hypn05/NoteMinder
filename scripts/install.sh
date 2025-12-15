#!/bin/bash

# NoteMinder Installation Script
# This script downloads and installs NoteMinder on macOS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_error "This script is only for macOS"
    exit 1
fi

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    ARCH_SUFFIX="-arm64"
    ARCH_NAME="Apple Silicon"
elif [[ "$ARCH" == "x86_64" ]]; then
    ARCH_SUFFIX=""
    ARCH_NAME="Intel"
else
    print_error "Unsupported architecture: $ARCH"
    exit 1
fi

print_info "Detected architecture: $ARCH_NAME"

# Get latest version from GitHub
print_info "Fetching latest version..."
LATEST_VERSION=$(curl -s https://api.github.com/repos/hypn05/NoteMinder/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')

if [ -z "$LATEST_VERSION" ]; then
    print_error "Failed to fetch latest version"
    exit 1
fi

print_info "Latest version: v$LATEST_VERSION"

# Construct download URL
DMG_NAME="NoteMinder-${LATEST_VERSION}${ARCH_SUFFIX}.dmg"
DOWNLOAD_URL="https://github.com/hypn05/NoteMinder/releases/download/v${LATEST_VERSION}/${DMG_NAME}"

print_info "Downloading NoteMinder..."
TEMP_DIR=$(mktemp -d)
DMG_PATH="${TEMP_DIR}/${DMG_NAME}"

if ! curl -L -o "$DMG_PATH" "$DOWNLOAD_URL"; then
    print_error "Failed to download NoteMinder"
    rm -rf "$TEMP_DIR"
    exit 1
fi

print_success "Download complete"

# Mount the DMG
print_info "Mounting disk image..."
MOUNT_POINT=$(hdiutil attach "$DMG_PATH" | grep Volumes | sed 's/.*\/Volumes/\/Volumes/')

if [ -z "$MOUNT_POINT" ]; then
    print_error "Failed to mount disk image"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# Copy app to Applications
print_info "Installing NoteMinder to /Applications..."
if [ -d "/Applications/NoteMinder.app" ]; then
    print_warning "NoteMinder.app already exists in /Applications, removing old version..."
    rm -rf "/Applications/NoteMinder.app"
fi

cp -R "${MOUNT_POINT}/NoteMinder.app" /Applications/

# Unmount DMG
hdiutil detach "$MOUNT_POINT" -quiet

# Clean up
rm -rf "$TEMP_DIR"

print_success "NoteMinder installed successfully!"
echo ""
print_info "To launch NoteMinder:"
echo "  1. Open Applications folder"
echo "  2. Find NoteMinder"
echo "  3. Right-click and select 'Open' (first time only)"
echo "  4. Click 'Open' in the security dialog"
echo ""
print_warning "Note: Since the app is not signed, you'll need to approve it in System Preferences > Security & Privacy"
echo ""
print_success "Installation complete!"

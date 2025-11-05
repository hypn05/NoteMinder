#!/bin/bash

# NoteMinder Release Script
# This script creates a versioned git release with builds for all platforms

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not a git repository!"
    exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    print_warning "You have uncommitted changes:"
    git status -s
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
print_info "Current version: $CURRENT_VERSION"

# Ask for new version
echo ""
echo "Enter new version number (or press Enter to use $CURRENT_VERSION):"
read NEW_VERSION

if [ -z "$NEW_VERSION" ]; then
    NEW_VERSION=$CURRENT_VERSION
fi

# Validate version format (basic semver check)
if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format. Please use semantic versioning (e.g., 1.0.0)"
    exit 1
fi

print_info "Release version: $NEW_VERSION"

# Update version in package.json
print_info "Updating package.json version..."
npm version $NEW_VERSION --no-git-tag-version
print_success "Version updated to $NEW_VERSION"

# Clean previous builds
print_info "Cleaning previous builds..."
rm -rf dist/
print_success "Clean complete"

# Build for all platforms
print_info "Building for all platforms..."
echo ""

print_info "Building for macOS (Intel x64)..."
npm run build -- --mac --x64
print_success "macOS Intel build complete"

print_info "Building for macOS (Apple Silicon arm64)..."
npm run build -- --mac --arm64
print_success "macOS ARM64 build complete"

print_info "Building for Windows..."
npm run build -- --win
print_success "Windows build complete"

print_info "Building for Linux..."
npm run build -- --linux
print_success "Linux build complete"

# List built files
print_info "Built files:"
ls -lh dist/

# Create release directory
RELEASE_DIR="releases/v$NEW_VERSION"
mkdir -p "$RELEASE_DIR"

# Copy builds to release directory
print_info "Copying builds to release directory..."
cp dist/*.dmg "$RELEASE_DIR/" 2>/dev/null || true
cp dist/*.exe "$RELEASE_DIR/" 2>/dev/null || true
cp dist/*.AppImage "$RELEASE_DIR/" 2>/dev/null || true
print_success "Builds copied to $RELEASE_DIR"

# Commit version change
print_info "Committing version change..."
git add package.json package-lock.json
git commit -m "chore: bump version to $NEW_VERSION"
print_success "Version change committed"

# Create git tag
print_info "Creating git tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
print_success "Tag created"

# Push changes and tag
echo ""
print_warning "Ready to push changes and tag to remote repository"
read -p "Push to remote? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Pushing changes..."
    git push origin main
    git push origin "v$NEW_VERSION"
    print_success "Changes and tag pushed to remote"
    
    echo ""
    print_success "Release v$NEW_VERSION created successfully!"
    echo ""
    print_info "Next steps:"
    echo "  1. Go to GitHub repository"
    echo "  2. Navigate to Releases"
    echo "  3. Click 'Draft a new release'"
    echo "  4. Select tag: v$NEW_VERSION"
    echo "  5. Upload files from: $RELEASE_DIR"
    echo "  6. Add release notes and publish"
    echo ""
    print_info "Or use GitHub CLI to create release automatically:"
    echo "  gh release create v$NEW_VERSION $RELEASE_DIR/* --title \"NoteMinder v$NEW_VERSION\" --notes \"Release notes here\""
else
    print_warning "Changes not pushed. You can push manually later with:"
    echo "  git push origin main"
    echo "  git push origin v$NEW_VERSION"
fi

echo ""
print_success "Release process complete!"

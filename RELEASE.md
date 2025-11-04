# Release Guide

This document provides instructions for creating and publishing releases of NoteMinder.

## Prerequisites

Before creating a release, ensure you have:

- [ ] All changes committed to git
- [ ] Tests passing (if applicable)
- [ ] Updated documentation
- [ ] Node.js and npm installed
- [ ] electron-builder dependencies installed (`npm install`)

## Creating a Release

### Automated Release Process

The easiest way to create a release is using the automated script:

```bash
npm run release
```

Or directly:

```bash
./scripts/release.sh
```

This script will:

1. Check for uncommitted changes
2. Prompt for the new version number
3. Update `package.json` with the new version
4. Clean previous builds
5. Build for all platforms (macOS, Windows, Linux)
6. Copy builds to `releases/vX.X.X/` directory
7. Commit the version change
8. Create a git tag
9. Optionally push to GitHub

### Manual Release Process

If you prefer to do it manually:

1. **Update version in package.json**
   ```bash
   npm version 1.0.1 --no-git-tag-version
   ```

2. **Build for all platforms**
   ```bash
   npm run build -- --mac --win --linux
   ```

3. **Create release directory**
   ```bash
   mkdir -p releases/v1.0.1
   cp dist/*.dmg dist/*.exe dist/*.AppImage releases/v1.0.1/
   ```

4. **Commit and tag**
   ```bash
   git add package.json package-lock.json
   git commit -m "chore: bump version to 1.0.1"
   git tag -a v1.0.1 -m "Release v1.0.1"
   ```

5. **Push to GitHub**
   ```bash
   git push origin main
   git push origin v1.0.1
   ```

## Publishing to GitHub

### Option 1: GitHub Web Interface

1. Go to your repository on GitHub
2. Click on "Releases" in the right sidebar
3. Click "Draft a new release"
4. Select the tag you just created (e.g., `v1.0.1`)
5. Set the release title (e.g., "NoteMinder v1.0.1")
6. Add release notes describing changes
7. Upload the build files from `releases/v1.0.1/`:
   - `NoteMinder-X.X.X-arm64.dmg` (macOS Apple Silicon)
   - `NoteMinder-X.X.X.dmg` (macOS Intel, if built)
   - `NoteMinder-Setup-X.X.X.exe` (Windows)
   - `NoteMinder-X.X.X.AppImage` (Linux)
8. Click "Publish release"

### Option 2: GitHub CLI

If you have [GitHub CLI](https://cli.github.com/) installed:

```bash
gh release create v1.0.1 releases/v1.0.1/* \
  --title "NoteMinder v1.0.1" \
  --notes "## What's New

- Feature 1
- Feature 2
- Bug fixes

## Downloads

Download the appropriate file for your platform below."
```

## Version Numbering

NoteMinder follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version (X.0.0): Incompatible API changes
- **MINOR** version (0.X.0): New functionality in a backward compatible manner
- **PATCH** version (0.0.X): Backward compatible bug fixes

Examples:
- `1.0.0` → `1.0.1`: Bug fix release
- `1.0.0` → `1.1.0`: New feature release
- `1.0.0` → `2.0.0`: Breaking changes

## Release Notes Template

When creating release notes, use this template:

```markdown
## What's New in v1.0.1

### ✨ New Features
- Feature description

### 🐛 Bug Fixes
- Bug fix description

### 🔧 Improvements
- Improvement description

### 📚 Documentation
- Documentation updates

## Downloads

Download the appropriate file for your platform:

- **macOS**: NoteMinder-1.0.1-arm64.dmg (Apple Silicon) or NoteMinder-1.0.1.dmg (Intel)
- **Windows**: NoteMinder-Setup-1.0.1.exe
- **Linux**: NoteMinder-1.0.1.AppImage

## Installation Instructions

See the [README](https://github.com/hypn05/NoteMinder#installation) for installation instructions.
```

## Build Artifacts

After building, you'll find these files in the `dist/` directory:

### macOS
- `NoteMinder-X.X.X-arm64.dmg` - DMG installer for Apple Silicon Macs
- `NoteMinder-X.X.X.dmg` - DMG installer for Intel Macs (if built on Intel)
- `mac-arm64/NoteMinder.app` - Unpacked application

### Windows
- `NoteMinder-Setup-X.X.X.exe` - NSIS installer
- `win-unpacked/` - Unpacked application directory

### Linux
- `NoteMinder-X.X.X.AppImage` - Portable AppImage
- `linux-unpacked/` - Unpacked application directory

## Troubleshooting

### Build Fails

If the build fails:

1. Check that all dependencies are installed: `npm install`
2. Clear the dist directory: `rm -rf dist/`
3. Try building for one platform at a time
4. Check electron-builder logs for specific errors

### Code Signing Issues (macOS)

The script will skip code signing if no valid certificate is found. This is normal for development builds. For distribution:

1. Obtain an Apple Developer certificate
2. Configure code signing in `package.json` under `build.mac`
3. See [electron-builder docs](https://www.electron.build/code-signing) for details

### Permission Denied

If you get "Permission denied" when running the script:

```bash
chmod +x scripts/release.sh
```

## Post-Release Checklist

After publishing a release:

- [ ] Verify downloads work from GitHub Releases page
- [ ] Test installation on each platform
- [ ] Update any external documentation
- [ ] Announce the release (social media, blog, etc.)
- [ ] Close related issues/PRs on GitHub
- [ ] Start planning next release

## Resources

- [Electron Builder Documentation](https://www.electron.build/)
- [Semantic Versioning](https://semver.org/)
- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [GitHub CLI Documentation](https://cli.github.com/manual/)

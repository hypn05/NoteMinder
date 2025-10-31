# NoteMinder

A beautiful, clutter-free note-taking application for macOS with reminders and a collapsible sidebar interface.

## Features

✨ **Clutter-Free Interface**: The app hides on the side of your screen with just an arrow tab visible. Click to expand!

📝 **Rich Note Taking**: Create notes with text and images

🎨 **Custom Background Colors**: Choose any background color for your notes

🖼️ **Image Support**: Add images via upload or drag-and-drop, and reposition them dynamically within your notes

💾 **Persistent Storage**: All notes are automatically saved locally

🍎 **Native macOS App**: Built with Electron for a native macOS experience

## Installation

1. Install dependencies:
```bash
npm install
```

2. Run the app in development mode:
```bash
npm start
```

## Building for macOS

To build a native macOS application:

```bash
npm run build-mac
```

This will create a `.dmg` file in the `dist` folder that you can install on any macOS system.

## Usage

1. **Opening the App**: Click the arrow tab on the right side of your screen to expand the notes panel

2. **Creating a Note**: 
   - Click the `+` button in the header
   - Choose a background color using the color picker
   - Type your note content
   - Add images by clicking the 📷 button or dragging images into the editor
   - Click "Save Note"

3. **Editing a Note**: Click on any note card to edit it

4. **Deleting a Note**: Hover over a note card and click the `×` button

5. **Repositioning Images**: In the editor, click and drag images to reposition them within your note

6. **Collapsing the App**: Click the arrow tab again to hide the app

## Keyboard Shortcuts

- The app stays on top of all other windows for easy access
- Minimize button: Minimizes the app to the dock
- Close button: Closes the application

## Data Storage

Notes are stored locally in your system's application data directory:
- macOS: `~/Library/Application Support/noteminder/notes.json`

## Customization

You can customize the app by modifying:
- `styles.css` - Change colors, fonts, and layout
- `main.js` - Adjust window size, position, and behavior
- `package.json` - Update app name, version, and build settings

## Building with Custom Icon

To add a custom icon:
1. Create a 1024x1024 PNG image
2. Convert it to `.icns` format using online tools or:
   ```bash
   # Create iconset directory
   mkdir MyIcon.iconset
   
   # Generate different sizes (requires ImageMagick)
   sips -z 16 16     icon.png --out MyIcon.iconset/icon_16x16.png
   sips -z 32 32     icon.png --out MyIcon.iconset/icon_16x16@2x.png
   sips -z 32 32     icon.png --out MyIcon.iconset/icon_32x32.png
   sips -z 64 64     icon.png --out MyIcon.iconset/icon_32x32@2x.png
   sips -z 128 128   icon.png --out MyIcon.iconset/icon_128x128.png
   sips -z 256 256   icon.png --out MyIcon.iconset/icon_128x128@2x.png
   sips -z 256 256   icon.png --out MyIcon.iconset/icon_256x256.png
   sips -z 512 512   icon.png --out MyIcon.iconset/icon_256x256@2x.png
   sips -z 512 512   icon.png --out MyIcon.iconset/icon_512x512.png
   sips -z 1024 1024 icon.png --out MyIcon.iconset/icon_512x512@2x.png
   
   # Convert to icns
   iconutil -c icns MyIcon.iconset
   ```
3. Replace `build/icon.icns` with your generated file

## Cross-Platform Support

While optimized for macOS, this app can also be built for:
- **Windows**: `npm run build` (creates NSIS installer)
- **Linux**: `npm run build` (creates AppImage)

## License

MIT License - Feel free to use and modify as needed!

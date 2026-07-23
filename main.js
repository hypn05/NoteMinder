const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, Notification, shell, globalShortcut, systemPreferences, powerMonitor, screen, clipboard } = require('electron');
const path = require('path');
const Storage = require('./utils/storage');
const ReminderManager = require('./utils/reminder');
const AutoUpdater = require('./utils/autoUpdater');
const SecurityManager = require('./utils/security');

// Storage instances
const notesStorage = new Storage('notes.json');
const settingsStorage = new Storage('settings.json');
const passwordsStorage = new Storage('passwords.json');
const securitySettingsStorage = new Storage('security-settings.json');
const clipsStorage = new Storage('clips.json');
const securityManager = new SecurityManager();

let mainWindow = null;
let searchWindow = null;
let tray = null;
let reminderManager = null;
let updateChecker = null;
let isCollapsed = true;
let currentScreenId = null;
let pendingUpdate = null;

// Which screen edge the floating tab is docked to, and its vertical
// position as a ratio (0-1) of the target display's work area height.
let currentEdge = 'right';
let tabYRatio = 0.5;
let dragStartBounds = null;
let isDraggingTab = false;
let widthDragStart = null;

// Authentication session tracking
let lastAuthTime = null;
let lastActivityTime = Date.now();
let authenticationGranted = false;

// Hide dock icon on macOS before app is ready
if (process.platform === 'darwin') {
  app.dock.hide();
}

// Computes the bounds that keep the window docked to `edge` at vertical
// ratio `yRatio` (0-1 of the display's work area height).
// Horizontal position uses the full display bounds so the tab sits flush
// against the physical screen edge. Vertical position is relative to the
// work area so the tab stays below the menu bar and above the dock.
// (Mixing bounds origin with workAreaSize width was leaving a gap equal to
// bounds.width - workArea.width whenever the dock/Stage Manager reduced the
// usable width — most visible when docked on the right.)
function computeSnappedBounds(width, height, edge, yRatio, targetDisplay) {
  const { x: boundX, width: boundW } = targetDisplay.bounds;
  const { y: workY, height: workH } = targetDisplay.workArea;

  const x = edge === 'left' ? boundX : boundX + boundW - width;
  let y = workY + Math.round(yRatio * workH) - Math.floor(height / 2);
  if (y < workY) y = workY;
  if (y + height > workY + workH) y = workY + workH - height;

  return { x, y, width, height };
}

function createWindow() {
  const settings = settingsStorage.read() || { theme: 'dark', stayInView: false, screenId: null };

  const displays = screen.getAllDisplays();

  // Find the selected screen or use primary display
  let targetDisplay = screen.getPrimaryDisplay();
  if (settings.screenId) {
    const savedDisplay = displays.find(d => d.id === settings.screenId);
    if (savedDisplay) {
      targetDisplay = savedDisplay;
    }
  }

  currentScreenId = targetDisplay.id;
  currentEdge = settings.edge === 'left' ? 'left' : 'right';
  tabYRatio = typeof settings.tabYRatio === 'number' ? settings.tabYRatio : 0.5;

  // Start collapsed: 30px width, 80px height (arrow tab size)
  const collapsedWidth = 30;
  const collapsedHeight = 80;
  const startBounds = computeSnappedBounds(collapsedWidth, collapsedHeight, currentEdge, tabYRatio, targetDisplay);

  mainWindow = new BrowserWindow({
    width: collapsedWidth,
    height: collapsedHeight,
    x: startBounds.x,
    y: startBounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // Set window properties
  mainWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true);
  }

  // Handle window blur
  mainWindow.on('blur', () => {
    const settings = settingsStorage.read() || { stayInView: false };
    if (!settings.stayInView && !isCollapsed) {
      mainWindow.webContents.send('collapse-sidebar');
    }
  });

  // Remember a manually-resized expanded size so the next expand uses it
  // instead of resetting to the default, and persist it across restarts.
  let resizeSaveTimer = null;
  mainWindow.on('resize', () => {
    if (isCollapsed || !mainWindow) return;
    const bounds = mainWindow.getBounds();
    mainWindow.webContents.send('window-resized', { width: bounds.width, height: bounds.height });

    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      const currentSettings = settingsStorage.read() || {};
      currentSettings.expandedWidth = bounds.width;
      currentSettings.expandedHeight = bounds.height;
      settingsStorage.write(currentSettings);
    }, 300);
  });

  // Continuously monitor and hide dock icon on macOS
  if (process.platform === 'darwin') {
    setInterval(() => {
      if (app.dock.isVisible()) {
        app.dock.hide();
      }
    }, 1000);
  }

  // Track mouse position for click-through
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init-settings', settings);
  });
}

function createSearchWindow() {
  if (searchWindow) {
    searchWindow.show();
    searchWindow.focus();
    searchWindow.webContents.send('focus-search');
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const windowWidth = 600;
  const windowHeight = 400;

  searchWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.floor((screenWidth - windowWidth) / 2),
    y: Math.floor((screenHeight - windowHeight) / 2) - 100,
    frame: false,
    transparent: true,
    // macOS draws a native shadow around the full window bounds; on a transparent
    // window that shows up as a ghost rectangle below the visible content. The
    // CSS box-shadow on .search-container already provides the visual shadow.
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  searchWindow.loadFile('search.html');
  
  // Show window when ready
  searchWindow.once('ready-to-show', () => {
    searchWindow.show();
    searchWindow.focus();
  });

  // Hide window when it loses focus
  searchWindow.on('blur', () => {
    searchWindow.hide();
  });

  searchWindow.on('closed', () => {
    searchWindow = null;
  });
}

function createTray() {
  // Try multiple icon paths for development and production
  let iconPath;
  const fs = require('fs');
  
  const possiblePaths = [
    path.join(__dirname, 'build', 'icon16x16.png'),
    path.join(process.resourcesPath, 'build', 'icon16x16.png'),
  ];
  
  // Find the first existing icon
  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      iconPath = testPath;
      break;
    }
  }
  
  if (!iconPath) {
    // Create a simple tray without icon as fallback
    iconPath = possiblePaths[0]; // Use first path anyway
  }
  
  tray = new Tray(iconPath);
  
  updateTrayMenu();
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  const settings = settingsStorage.read() || { theme: 'dark', stayInView: false, screenId: null };
  const displays = screen.getAllDisplays();
  
  // Build update menu item if update is available
  const updateMenuItem = pendingUpdate ? [
    {
      label: `Update Available (v${pendingUpdate.latestVersion})`,
      click: () => {
        // AutoUpdater doesn't download in-app; point the user to the release
        if (pendingUpdate.releaseUrl) {
          shell.openExternal(pendingUpdate.releaseUrl);
        }
      }
    },
    { type: 'separator' }
  ] : [];
  
  // Build screen selection submenu
  const screenSubmenu = displays.map((display, index) => {
    const isPrimary = display.id === screen.getPrimaryDisplay().id;
    const label = isPrimary 
      ? `Screen ${index + 1} (Primary) - ${display.bounds.width}x${display.bounds.height}`
      : `Screen ${index + 1} - ${display.bounds.width}x${display.bounds.height}`;
    
    return {
      label: label,
      type: 'radio',
      checked: display.id === (settings.screenId || screen.getPrimaryDisplay().id),
      click: () => {
        settings.screenId = display.id;
        settingsStorage.write(settings);
        
        // Reposition window to the new screen
        if (mainWindow) {
          repositionWindow(display.id);
        }
        
        updateTrayMenu();
      }
    };
  });
  
  const contextMenu = Menu.buildFromTemplate([
    ...updateMenuItem,
    {
      label: 'New Note',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('new-note');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Export Notes',
      click: async () => {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Notes',
          defaultPath: `notes-${new Date().toISOString().split('T')[0]}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        
        if (!result.canceled && result.filePath) {
          const notes = notesStorage.read() || [];
          const fs = require('fs');
          fs.writeFileSync(result.filePath, JSON.stringify(notes, null, 2));
          
          if (mainWindow) {
            mainWindow.webContents.send('show-message', {
              type: 'success',
              message: 'Notes exported successfully!'
            });
          }
        }
      }
    },
    {
      label: 'Import Notes',
      click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Import Notes',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile']
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
          try {
            const fs = require('fs');
            const data = fs.readFileSync(result.filePaths[0], 'utf8');
            const importedNotes = JSON.parse(data);
            
            const existingNotes = notesStorage.read() || [];
            const existingIds = new Set(existingNotes.map(n => n.id));
            
            let imported = 0;
            let skipped = 0;
            
            importedNotes.forEach(note => {
              if (!existingIds.has(note.id)) {
                existingNotes.push(note);
                imported++;
              } else {
                skipped++;
              }
            });
            
            notesStorage.write(existingNotes);
            
            if (mainWindow) {
              mainWindow.webContents.send('reload-notes');
              mainWindow.webContents.send('show-message', {
                type: 'success',
                message: `Import complete: ${imported} imported, ${skipped} skipped, ${importedNotes.length} total`
              });
            }
          } catch (error) {
            if (mainWindow) {
              mainWindow.webContents.send('show-message', {
                type: 'error',
                message: 'Failed to import notes: ' + error.message
              });
            }
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Display Screen',
      submenu: screenSubmenu
    },
    {
      label: 'Stay in View',
      type: 'checkbox',
      checked: settings.stayInView,
      click: (menuItem) => {
        settings.stayInView = menuItem.checked;
        settingsStorage.write(settings);
        updateTrayMenu();
      }
    },
    {
      label: 'Theme',
      submenu: [
        {
          label: 'Dark',
          type: 'radio',
          checked: settings.theme === 'dark',
          click: () => {
            settings.theme = 'dark';
            settingsStorage.write(settings);
            if (mainWindow) {
              mainWindow.webContents.send('theme-changed', 'dark');
            }
            updateTrayMenu();
          }
        },
        {
          label: 'Light',
          type: 'radio',
          checked: settings.theme === 'light',
          click: () => {
            settings.theme = 'light';
            settingsStorage.write(settings);
            if (mainWindow) {
              mainWindow.webContents.send('theme-changed', 'light');
            }
            updateTrayMenu();
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: async () => {
        if (updateChecker) {
          await updateChecker.checkForUpdates(true);
        }
      }
    },
    {
      label: 'About NoteMinder',
      click: () => {
        const version = require('./package.json').version;
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'About NoteMinder',
          message: 'NoteMinder',
          detail: `Version: ${version}\n\nA desktop note-taking application with collapsible sidebar.\n\n© 2025 NoteMinder`,
          buttons: ['OK']
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.setToolTip('NoteMinder');
}


// Reads the current OS clipboard and saves it as a clip, from any app.
// Shared by the global shortcut and the sidebar's "Add from Clipboard" button.
function captureClipboardClip() {
  const text = (clipboard.readText() || '').trim();
  if (!text) {
    return { success: false, error: 'Clipboard is empty' };
  }

  const clips = clipsStorage.read() || [];
  if (clips[0] && clips[0].text === text) {
    return { success: true, clip: clips[0], duplicate: true };
  }

  const clip = { id: Date.now().toString(), text, created: new Date().toISOString() };
  clips.unshift(clip);
  clipsStorage.write(clips);

  if (mainWindow) {
    mainWindow.webContents.send('reload-clips');
  }

  return { success: true, clip };
}

function repositionWindow(screenId) {
  if (!mainWindow) return;

  const displays = screen.getAllDisplays();
  let targetDisplay = displays.find(d => d.id === screenId);
  // Fall back to primary if the saved screen is gone (monitor unplugged, etc.)
  if (!targetDisplay) {
    targetDisplay = screen.getPrimaryDisplay();
  }

  currentScreenId = targetDisplay.id;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds(
    computeSnappedBounds(bounds.width, bounds.height, currentEdge, tabYRatio, targetDisplay)
  );
}

// IPC Handlers
ipcMain.handle('get-notes', () => {
  return notesStorage.read() || [];
});

ipcMain.handle('save-notes', (event, notes) => {
  return notesStorage.write(notes);
});

ipcMain.handle('get-settings', () => {
  return settingsStorage.read() || { theme: 'dark', stayInView: false };
});

ipcMain.handle('save-settings', (event, settings) => {
  settingsStorage.write(settings);
  updateTrayMenu();
  return true;
});

ipcMain.handle('get-passwords', () => {
  return passwordsStorage.read() || [];
});

ipcMain.handle('save-passwords', (event, passwords) => {
  return passwordsStorage.write(passwords);
});

ipcMain.handle('get-clips', () => {
  return clipsStorage.read() || [];
});

ipcMain.handle('save-clips', (event, clips) => {
  return clipsStorage.write(clips);
});

ipcMain.handle('capture-clipboard-clip', () => captureClipboardClip());

ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) {
    const displays = screen.getAllDisplays();

    let targetDisplay = displays.find(d => d.id === currentScreenId);
    if (!targetDisplay) {
      targetDisplay = screen.getPrimaryDisplay();
      currentScreenId = targetDisplay.id;
    }

    mainWindow.setBounds(
      computeSnappedBounds(width, height, currentEdge, tabYRatio, targetDisplay)
    );
  }
});

ipcMain.on('set-collapsed', (event, collapsed) => {
  isCollapsed = collapsed;
  if (mainWindow) {
    // Set the minimum size before resizable, and before the renderer's
    // follow-up 'resize-window' call, so collapsing to 30x80 is never
    // clamped by a leftover 500x300 minimum from the expanded state.
    mainWindow.setMinimumSize(collapsed ? 30 : 500, collapsed ? 80 : 300);
    mainWindow.setResizable(!collapsed);
  }
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// Dragging the floating tab: the renderer tracks mouse movement itself
// (app-region drag can't tell us when the drag ends, which we need to
// snap back to an edge), and streams deltas here to move the window.
ipcMain.on('tab-drag-start', () => {
  if (mainWindow) {
    dragStartBounds = mainWindow.getBounds();
  }
});

ipcMain.on('tab-drag-move', (event, { dx, dy }) => {
  if (mainWindow && dragStartBounds) {
    // Only disable resizing once real movement is confirmed, since a
    // plain click (no move) never fires 'tab-drag-end' to restore it.
    if (!isDraggingTab) {
      isDraggingTab = true;
      mainWindow.setResizable(false);
    }
    dragStartBounds.x += dx;
    dragStartBounds.y += dy;
    mainWindow.setBounds(dragStartBounds);
  }
});

ipcMain.on('tab-drag-end', () => {
  isDraggingTab = false;
  if (!mainWindow) {
    dragStartBounds = null;
    return;
  }

  const displays = screen.getAllDisplays();
  const bounds = mainWindow.getBounds();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const targetDisplay = displays.find(d =>
    centerX >= d.bounds.x && centerX < d.bounds.x + d.bounds.width &&
    centerY >= d.bounds.y && centerY < d.bounds.y + d.bounds.height
  ) || screen.getPrimaryDisplay();

  currentScreenId = targetDisplay.id;
  currentEdge = (centerX - targetDisplay.bounds.x) < targetDisplay.bounds.width / 2 ? 'left' : 'right';
  tabYRatio = Math.min(1, Math.max(0,
    (centerY - targetDisplay.workArea.y) / targetDisplay.workArea.height
  ));

  dragStartBounds = null;
  repositionWindow(currentScreenId);
  mainWindow.setResizable(!isCollapsed);
  mainWindow.webContents.send('edge-changed', currentEdge);

  const settings = settingsStorage.read() || {};
  settings.edge = currentEdge;
  settings.tabYRatio = tabYRatio;
  settings.screenId = currentScreenId;
  settingsStorage.write(settings);
  updateTrayMenu();
});

// Custom horizontal resize: native edge-resize on this transparent frameless
// window is unreliable on macOS (drags on the left/right border are
// inconsistently hit-tested), so width changes are driven manually here,
// the same way tab dragging is.
ipcMain.on('width-drag-start', () => {
  if (mainWindow) {
    widthDragStart = { bounds: mainWindow.getBounds(), edge: currentEdge };
  }
});

ipcMain.on('width-drag-move', (event, { dx }) => {
  if (!mainWindow || !widthDragStart) return;

  const displays = screen.getAllDisplays();
  let targetDisplay = displays.find(d => d.id === currentScreenId);
  if (!targetDisplay) {
    targetDisplay = screen.getPrimaryDisplay();
    currentScreenId = targetDisplay.id;
  }

  const { bounds, edge } = widthDragStart;
  let newWidth = edge === 'left' ? bounds.width + dx : bounds.width - dx;
  const maxWidth = targetDisplay.workAreaSize.width - 40;
  newWidth = Math.max(500, Math.min(newWidth, maxWidth));

  mainWindow.setBounds(
    computeSnappedBounds(newWidth, bounds.height, edge, tabYRatio, targetDisplay)
  );
});

ipcMain.on('width-drag-end', () => {
  widthDragStart = null;
});

ipcMain.on('show-notification', (event, { title, body, noteId }) => {
  // Check if notifications are supported
  if (!Notification.isSupported()) {
    if (mainWindow) {
      mainWindow.webContents.send('show-message', {
        type: 'error',
        message: 'Notifications are not supported on this system'
      });
    }
    return;
  }

  try {
    const notification = new Notification({
      title: title,
      body: body,
      silent: false
    });
    
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('open-note', noteId);
      }
    });
    
    notification.show();
  } catch (error) {
    if (mainWindow) {
      mainWindow.webContents.send('show-message', {
        type: 'error',
        message: 'Failed to show notification. Please check system permissions.'
      });
    }
  }
});

ipcMain.handle('check-notification-permission', async () => {
  return Notification.isSupported();
});

ipcMain.handle('check-for-updates', async () => {
  if (updateChecker) {
    await updateChecker.checkForUpdates(true);
  }
  return null;
});

ipcMain.on('open-external-link', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('import-markdown', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Markdown',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] }
    ],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const fs = require('fs');
    const content = fs.readFileSync(result.filePaths[0], 'utf8');
    return { success: true, content };
  }
  
  return { success: false };
});

// IPC Handlers for search window
ipcMain.on('open-note-from-search', (event, noteId) => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    if (isCollapsed) {
      mainWindow.webContents.send('expand-sidebar');
    }
    mainWindow.webContents.send('open-note', noteId);
  }
  if (searchWindow) {
    searchWindow.hide();
  }
});

ipcMain.on('close-search-window', () => {
  if (searchWindow) {
    searchWindow.hide();
  }
});

ipcMain.on('open-search-window', () => {
  createSearchWindow();
});

ipcMain.on('create-note-from-search', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    if (isCollapsed) {
      mainWindow.webContents.send('expand-sidebar');
    }
    mainWindow.webContents.send('new-note');
  }
  if (searchWindow) {
    searchWindow.hide();
  }
});

// Security IPC Handlers
ipcMain.handle('encrypt-password-entry', async (event, passwordData) => {
  try {
    const encrypted = securityManager.encryptPasswordEntry(passwordData);
    return { success: true, data: encrypted };
  } catch (error) {
    console.error('[Security] Encryption failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('decrypt-password-entry', async (event, encryptedData) => {
  try {
    // Get security settings to check authentication policy
    const securitySettings = securitySettingsStorage.read() || {
      authenticationPolicy: 'always',
      idleTimeout: 300
    };
    
    const now = Date.now();
    let needsAuth = false;
    
    // Determine if authentication is needed based on policy
    switch (securitySettings.authenticationPolicy) {
      case 'always':
        needsAuth = true;
        break;
        
      case 'once_per_session':
        // Only authenticate once per app session
        if (!authenticationGranted) {
          needsAuth = true;
        }
        break;
        
      case 'after_idle':
        // Authenticate if idle timeout has passed
        const idleTimeMs = securitySettings.idleTimeout * 1000;
        if (!lastAuthTime || (now - lastActivityTime) > idleTimeMs) {
          needsAuth = true;
        }
        break;
    }
    
    // Update activity time
    lastActivityTime = now;
    
    // Perform authentication if needed
    if (needsAuth && process.platform === 'darwin') {
      const authResult = await securityManager.verifyAccess();
      if (!authResult) {
        return { success: false, error: 'Authentication failed' };
      }
      lastAuthTime = now;
      authenticationGranted = true;
    }
    
    // Decrypt the password entry
    const decrypted = securityManager.decryptPasswordEntry(encryptedData);
    return { success: true, data: decrypted };
  } catch (error) {
    console.error('[Security] Decryption failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('verify-security-access', async () => {
  try {
    const hasAccess = await securityManager.verifyAccess();
    return { success: hasAccess };
  } catch (error) {
    console.error('[Security] Access verification failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-encryption-info', () => {
  return securityManager.getEncryptionInfo();
});

ipcMain.handle('generate-password', (event, length, options) => {
  try {
    const password = securityManager.generatePassword(length, options);
    return { success: true, password };
  } catch (error) {
    console.error('[Security] Password generation failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('request-system-auth', async (event, reason) => {
  // On macOS, system authentication is handled automatically by safeStorage
  // This handler is for explicit authentication requests
  if (process.platform === 'darwin') {
    try {
      // Verify access which will trigger Touch ID/password prompt
      const result = await securityManager.verifyAccess();
      return { success: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  // For other platforms, assume authentication is handled by the OS
  return { success: true };
});

// Security Settings IPC Handlers
ipcMain.handle('get-security-settings', () => {
  return securitySettingsStorage.read();
});

ipcMain.handle('save-security-settings', (event, settings) => {
  securitySettingsStorage.write(settings);
  // Reset authentication when settings change
  authenticationGranted = false;
  lastAuthTime = null;
  return true;
});

// Activity tracking - called from renderer to update last activity time
ipcMain.on('update-activity', () => {
  lastActivityTime = Date.now();
});

// Reset authentication session
ipcMain.handle('reset-auth-session', () => {
  authenticationGranted = false;
  lastAuthTime = null;
  return true;
});

// Re-anchor the window to the right edge whenever screen geometry changes.
// Without this the absolute position from the last setBounds becomes stale
// after sleep/wake, monitor plug-unplug, resolution change, or workArea shift,
// and the tab appears to "float" somewhere away from the edge (macOS only —
// Windows' window manager tends to re-snap borderless windows automatically).
function reanchorToCurrentScreen() {
  if (mainWindow) {
    repositionWindow(currentScreenId);
  }
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();

  screen.on('display-metrics-changed', reanchorToCurrentScreen);
  screen.on('display-added', reanchorToCurrentScreen);
  screen.on('display-removed', reanchorToCurrentScreen);
  powerMonitor.on('resume', reanchorToCurrentScreen);
  
  // Register global shortcut for search
  const searchShortcut = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
  const ret = globalShortcut.register(searchShortcut, () => {
    createSearchWindow();
  });
  
  if (!ret) {
    console.error('Global shortcut registration failed');
  }

  // Register global shortcut to save the current clipboard as a clip,
  // from any app, without needing to open NoteMinder first
  const clipShortcut = process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V';
  const clipRet = globalShortcut.register(clipShortcut, () => {
    const result = captureClipboardClip();
    if (result.success && !result.duplicate && Notification.isSupported()) {
      const preview = result.clip.text.length > 60
        ? result.clip.text.substring(0, 60) + '...'
        : result.clip.text;
      new Notification({ title: 'Clip saved', body: preview, silent: true }).show();
    }
  });

  if (!clipRet) {
    console.error('Clip shortcut registration failed');
  }

  // Request notification permissions on macOS
  if (process.platform === 'darwin') {
    // macOS requires explicit permission request
    app.setAboutPanelOptions({
      applicationName: 'NoteMinder',
      applicationVersion: '1.0.0'
    });
    
    // Show a test notification to trigger permission request
    if (Notification.isSupported()) {
      try {
        const testNotification = new Notification({
          title: 'NoteMinder',
          body: 'Notifications are enabled! You will receive reminder alerts.',
          silent: true
        });
        testNotification.show();
      } catch (error) {
        // Silent fail - permissions will be requested when first reminder fires
      }
    }
  }
  
  // Initialize reminder manager
  reminderManager = new ReminderManager(() => {
    if (mainWindow) {
      mainWindow.webContents.send('check-reminders');
    }
  }); 
  reminderManager.start();
  
  // Initialize update checker
  updateChecker = new AutoUpdater(mainWindow);
  updateChecker.start();
  
  // Check for updates and notify if available
  const updateInfo = await updateChecker.checkForUpdates();
  if (updateInfo) {
    pendingUpdate = updateInfo;
    updateTrayMenu();
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close
});

app.on('before-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  
  if (reminderManager) {
    reminderManager.stop();
  }
  if (updateChecker) {
    updateChecker.stop();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

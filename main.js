const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, Notification, shell, globalShortcut, systemPreferences, powerMonitor, screen } = require('electron');
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
const securityManager = new SecurityManager();

let mainWindow = null;
let searchWindow = null;
let tray = null;
let reminderManager = null;
let updateChecker = null;
let isCollapsed = true;
let currentScreenId = null;
let pendingUpdate = null;

// Authentication session tracking
let lastAuthTime = null;
let lastActivityTime = Date.now();
let authenticationGranted = false;

// Hide dock icon on macOS before app is ready
if (process.platform === 'darwin') {
  app.dock.hide();
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
  const { width: screenWidth, height: screenHeight } = targetDisplay.workAreaSize;
  const { x: screenX, y: screenY } = targetDisplay.bounds;

  // Start collapsed: 30px width, 80px height (arrow tab size)
  const collapsedWidth = 30;
  const collapsedHeight = 80;

  mainWindow = new BrowserWindow({
    width: collapsedWidth,
    height: collapsedHeight,
    x: screenX + screenWidth - collapsedWidth,
    y: screenY + Math.floor((screenHeight - collapsedHeight) / 2),
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
        // Trigger the download through AutoUpdater
        if (updateChecker) {
          updateChecker.downloadUpdate();
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
  const { width: screenWidth, height: screenHeight } = targetDisplay.workAreaSize;
  const { x: screenX, y: screenY } = targetDisplay.bounds;

  mainWindow.setBounds({
    x: screenX + screenWidth - bounds.width,
    y: screenY + Math.floor((screenHeight - bounds.height) / 2),
    width: bounds.width,
    height: bounds.height
  });
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

ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) {
    const displays = screen.getAllDisplays();

    let targetDisplay = displays.find(d => d.id === currentScreenId);
    if (!targetDisplay) {
      targetDisplay = screen.getPrimaryDisplay();
      currentScreenId = targetDisplay.id;
    }

    const { width: screenWidth, height: screenHeight } = targetDisplay.workAreaSize;
    const { x: screenX, y: screenY } = targetDisplay.bounds;

    mainWindow.setBounds({
      x: screenX + screenWidth - width,
      y: screenY + Math.floor((screenHeight - height) / 2),
      width: width,
      height: height
    });
  }
});

ipcMain.on('set-collapsed', (event, collapsed) => {
  isCollapsed = collapsed;
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
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

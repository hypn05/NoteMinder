const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, Notification, shell } = require('electron');
const path = require('path');
const Storage = require('./utils/storage');
const ReminderManager = require('./utils/reminder');
const AutoUpdater = require('./utils/autoUpdater');

// Storage instances
const notesStorage = new Storage('notes.json');
const settingsStorage = new Storage('settings.json');

let mainWindow = null;
let tray = null;
let reminderManager = null;
let updateChecker = null;
let isCollapsed = true;
let currentScreenId = null;
let pendingUpdate = null;

// Hide dock icon on macOS before app is ready
if (process.platform === 'darwin') {
  app.dock.hide();
}

function createWindow() {
  const settings = settingsStorage.read() || { theme: 'dark', stayInView: false, screenId: null };
  
  // Get screen dimensions
  const { screen } = require('electron');
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
  
  // Calculate 80% of screen height
  const windowHeight = Math.floor(screenHeight * 0.8);
  
  mainWindow = new BrowserWindow({
    width: 30,
    height: windowHeight,
    x: 0,
    y: 0,
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
  
  // Position window at right edge of screen, centered vertically
  mainWindow.setPosition(screenX + screenWidth - 30, screenY + Math.floor((screenHeight - windowHeight) / 2));

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
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  
  // Build update menu item if update is available
  const updateMenuItem = pendingUpdate ? [
    {
      label: `Update Available (v${pendingUpdate.latestVersion})`,
      click: () => {
        showUpdateDialog(pendingUpdate);
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

function showUpdateDialog(updateInfo) {
  const options = {
    type: 'info',
    title: 'Update Available',
    message: `A new version of NoteMinder is available!`,
    detail: `Current version: ${updateInfo.currentVersion}\nNew version: ${updateInfo.latestVersion}\n\nWould you like to download it now?`,
    buttons: ['Download', 'View Release Notes', 'Later'],
    defaultId: 0,
    cancelId: 2
  };

  dialog.showMessageBox(mainWindow, options).then(result => {
    if (result.response === 0) {
      // Download - open the release page
      shell.openExternal(updateInfo.releaseUrl);
    } else if (result.response === 1) {
      // View Release Notes
      if (mainWindow) {
        mainWindow.webContents.send('show-update-notes', updateInfo);
      }
    }
  });
}

function repositionWindow(screenId) {
  if (!mainWindow) return;
  
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id === screenId);
  
  if (!targetDisplay) return;
  
  currentScreenId = screenId;
  const bounds = mainWindow.getBounds();
  const { width: screenWidth, height: screenHeight } = targetDisplay.workAreaSize;
  const { x: screenX, y: screenY } = targetDisplay.bounds;
  
  // Position window at right edge of the target screen
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

ipcMain.on('resize-window', (event, width) => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    
    // Find the current screen
    let targetDisplay = displays.find(d => d.id === currentScreenId);
    if (!targetDisplay) {
      targetDisplay = screen.getPrimaryDisplay();
      currentScreenId = targetDisplay.id;
    }
    
    const { width: screenWidth, height: screenHeight } = targetDisplay.workAreaSize;
    const { x: screenX, y: screenY } = targetDisplay.bounds;
    
    // Position window at right edge of screen
    mainWindow.setBounds({
      x: screenX + screenWidth - width,
      y: screenY + Math.floor((screenHeight - bounds.height) / 2),
      width: width,
      height: bounds.height
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

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  
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
    
    // Show notification about update
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'NoteMinder Update Available',
        body: `Version ${updateInfo.latestVersion} is now available!`,
        silent: false
      });
      
      notification.on('click', () => {
        showUpdateDialog(updateInfo);
      });
      
      notification.show();
    }
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close
});

app.on('before-quit', () => {
  if (reminderManager) {
    reminderManager.stop();
  }
  if (updateChecker) {
    updateChecker.stop();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

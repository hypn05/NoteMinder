const { app, BrowserWindow, ipcMain, screen, shell, Notification, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

  // Hide dock icon and remove from app switcher on macOS - MUST be done before creating window
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  }

let mainWindow;
let tray = null;
const NOTES_FILE = path.join(app.getPath('userData'), 'notes.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function createWindow() {
  console.log('=== CREATE WINDOW DEBUG ===');
  console.log('App is packaged:', app.isPackaged);
  console.log('__dirname:', __dirname);
  console.log('process.resourcesPath:', process.resourcesPath);
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  console.log('Screen size:', { width, height });
  
  const preloadPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar', 'preload.js')
    : path.join(__dirname, 'preload.js');
  
  console.log('Preload path:', preloadPath);
  console.log('Preload exists:', fs.existsSync(preloadPath));
  
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon128x128.png')
    : path.join(__dirname, 'build', 'icon128x128.png');
  
  mainWindow = new BrowserWindow({
    width: 400,
    height: height,
    minWidth: 300,
    minHeight: 400,
    maxWidth: 800,
    x: width - 400,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    show: false, // Don't show until ready
    icon: iconPath,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: -100, y: -100 }
    } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  console.log('BrowserWindow created');
  
  mainWindow.loadFile('index.html').then(() => {
    console.log('index.html loaded successfully');
  }).catch(err => {
    console.error('Error loading index.html:', err);
  });
  
  // Keep window on top of all other windows
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true);
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
    mainWindow.focus();
    console.log('Window shown and focused');
  });
  
  // Add error handler
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
  
  // Log when DOM is ready
  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM ready');
  });
  
  // Log window creation for debugging
  console.log('Window created at position:', { x: width - 400, y: 0, width: 400, height });
  console.log('===========================');
}

app.whenReady().then(() => {

    app.setName('NoteMinder');
  
  // Setup notifications
  if (Notification.isSupported()) {
    console.log('Notifications are supported on this system');
  } else {
    console.error('Notifications are NOT supported on this system');
  }
  
  // Create window AFTER setting activation policy
  createWindow();
  
  // Create tray icon after window is ready
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function updateTrayMenu() {
  // Load current settings
  let currentTheme = 'dark';
  let stayInView = false;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      currentTheme = settings.theme || 'dark';
      stayInView = settings.stayInView || false;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'New Note',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('create-new-note');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Export Notes...',
      click: async () => {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Notes',
          defaultPath: `NoteMinder-Export-${new Date().toISOString().split('T')[0]}.json`,
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.canceled) {
          try {
            let notes = [];
            if (fs.existsSync(NOTES_FILE)) {
              const data = fs.readFileSync(NOTES_FILE, 'utf8');
              notes = JSON.parse(data);
            }
            fs.writeFileSync(result.filePath, JSON.stringify(notes, null, 2));
            
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Export Successful',
              message: `Successfully exported ${notes.length} note(s)`,
              buttons: ['OK']
            });
          } catch (error) {
            dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Export Failed',
              message: `Failed to export notes: ${error.message}`,
              buttons: ['OK']
            });
          }
        }
      }
    },
    {
      label: 'Import Notes...',
      click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Import Notes',
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ],
          properties: ['openFile']
        });

        if (!result.canceled) {
          try {
            const importedData = fs.readFileSync(result.filePaths[0], 'utf8');
            const importedNotes = JSON.parse(importedData);

            if (!Array.isArray(importedNotes)) {
              throw new Error('Invalid notes file format');
            }

            let existingNotes = [];
            if (fs.existsSync(NOTES_FILE)) {
              const data = fs.readFileSync(NOTES_FILE, 'utf8');
              existingNotes = JSON.parse(data);
            }

            const existingIds = new Set(existingNotes.map(n => n.id));
            const newNotes = importedNotes.filter(n => !existingIds.has(n.id));
            const mergedNotes = [...existingNotes, ...newNotes];

            fs.writeFileSync(NOTES_FILE, JSON.stringify(mergedNotes, null, 2));

            // Notify renderer to reload notes
            if (mainWindow) {
              mainWindow.webContents.send('notes-imported');
            }

            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Import Successful',
              message: `Imported ${newNotes.length} new note(s)\nSkipped ${importedNotes.length - newNotes.length} duplicate(s)\nTotal notes: ${mergedNotes.length}`,
              buttons: ['OK']
            });
          } catch (error) {
            dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Import Failed',
              message: `Failed to import notes: ${error.message}`,
              buttons: ['OK']
            });
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Stay in View',
      type: 'checkbox',
      checked: stayInView,
      click: () => {
        toggleStayInView();
      }
    },
    {
      label: 'Theme',
      submenu: [
        {
          label: 'Dark',
          type: 'radio',
          checked: currentTheme === 'dark',
          click: () => {
            setTheme('dark');
          }
        },
        {
          label: 'Light',
          type: 'radio',
          checked: currentTheme === 'light',
          click: () => {
            setTheme('light');
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  if (tray) {
    tray.setContextMenu(contextMenu);
  }
}

function setTheme(theme) {
  try {
    // Save theme to settings
    let settings = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
    settings.theme = theme;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    
    // Update tray menu
    updateTrayMenu();
    
    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('theme-changed', theme);
    }
  } catch (error) {
    console.error('Error setting theme:', error);
  }
}

function toggleStayInView() {
  try {
    // Load current settings
    let settings = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
    
    // Toggle stayInView
    settings.stayInView = !settings.stayInView;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    
    // Update tray menu
    updateTrayMenu();
    
    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('stay-in-view-changed', settings.stayInView);
    }
  } catch (error) {
    console.error('Error toggling stay in view:', error);
  }
}

function createTray() {
  // Determine the correct icon path for both development and production
  let iconPath;
  
  if (app.isPackaged) {
    // In production, resources are in the app.asar or Resources folder
    iconPath = path.join(process.resourcesPath, 'build', 'icon16x16.png');
  } else {
    // In development
    iconPath = path.join(__dirname, 'build', 'icon16x16.png');
  }
  
  console.log('Tray icon path:', iconPath);
  console.log('Icon exists:', fs.existsSync(iconPath));
  
  // Verify icon exists, fallback to template icon if needed
  if (!fs.existsSync(iconPath)) {
    console.error('Tray icon not found at:', iconPath);
    // Try alternative path
    iconPath = path.join(__dirname, 'build', 'icon16x16.png');
    console.log('Trying alternative path:', iconPath);
  }
  
  try {
    tray = new Tray(iconPath);
    console.log('Tray created successfully');
    
    updateTrayMenu();
    
    tray.setToolTip('NoteMinder');
    
    // Add click handler to show/focus window
    tray.on('click', () => {
      console.log('Tray icon clicked');
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (error) {
    console.error('Error creating tray:', error);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for note management
ipcMain.handle('load-notes', async () => {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      const data = fs.readFileSync(NOTES_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error loading notes:', error);
    return [];
  }
});

ipcMain.handle('save-notes', async (event, notes) => {
  try {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving notes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening external link:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('schedule-reminder', async (event, reminder) => {
  try {
    // Reminder scheduling is handled in the renderer process
    // This handler is here for future server-side scheduling if needed
    return { success: true };
  } catch (error) {
    console.error('Error scheduling reminder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-notification', async (event, options) => {
  try {
    console.log('=== NOTIFICATION DEBUG ===');
    console.log('Attempting to show notification:', options);
    console.log('Notification supported:', Notification.isSupported());
    console.log('Current time:', new Date().toString());
    
    if (!Notification.isSupported()) {
      console.error('Notifications are not supported on this system');
      return { success: false, error: 'Notifications not supported' };
    }
    
    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: false
    });
    
    notification.on('show', () => {
      console.log('Notification shown successfully!');
    });
    
    notification.on('click', () => {
      console.log('Notification clicked!');
      // Focus the window and send note ID to renderer
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('notification-clicked', options.noteId);
      }
    });
    
    notification.on('close', () => {
      console.log('Notification closed');
    });
    
    notification.on('failed', (event, error) => {
      console.error('Notification failed:', error);
    });
    
    notification.show();
    console.log('Notification.show() called');
    console.log('=========================');
    
    return { success: true };
  } catch (error) {
    console.error('Error showing notification:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('resize-window', async (event, width, height) => {
  try {
    if (mainWindow) {
      const currentBounds = mainWindow.getBounds();
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      
      // Keep window aligned to right edge
      mainWindow.setBounds({
        x: screenWidth - width,
        y: currentBounds.y,
        width: width,
        height: height
      });
    }
    return { success: true };
  } catch (error) {
    console.error('Error resizing window:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-window-size', async () => {
  try {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      return { width: bounds.width, height: bounds.height };
    }
    return { width: 400, height: 600 };
  } catch (error) {
    console.error('Error getting window size:', error);
    return { width: 400, height: 600 };
  }
});

ipcMain.handle('set-ignore-mouse-events', async (event, ignore, options = {}) => {
  try {
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
    return { success: true };
  } catch (error) {
    console.error('Error setting ignore mouse events:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-theme', async () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return settings.theme || 'dark';
    }
    return 'dark';
  } catch (error) {
    console.error('Error loading theme:', error);
    return 'dark';
  }
});

ipcMain.handle('get-stay-in-view', async () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return settings.stayInView || false;
    }
    return false;
  } catch (error) {
    console.error('Error loading stay in view setting:', error);
    return false;
  }
});

ipcMain.handle('export-notes', async () => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Notes',
      defaultPath: `NoteMinder-Export-${new Date().toISOString().split('T')[0]}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return { success: false, canceled: true };
    }

    // Read current notes
    let notes = [];
    if (fs.existsSync(NOTES_FILE)) {
      const data = fs.readFileSync(NOTES_FILE, 'utf8');
      notes = JSON.parse(data);
    }

    // Write to selected file
    fs.writeFileSync(result.filePath, JSON.stringify(notes, null, 2));
    
    return { success: true, path: result.filePath, count: notes.length };
  } catch (error) {
    console.error('Error exporting notes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-notes', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Notes',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled) {
      return { success: false, canceled: true };
    }

    // Read the imported file
    const importedData = fs.readFileSync(result.filePaths[0], 'utf8');
    const importedNotes = JSON.parse(importedData);

    if (!Array.isArray(importedNotes)) {
      return { success: false, error: 'Invalid notes file format' };
    }

    // Load existing notes
    let existingNotes = [];
    if (fs.existsSync(NOTES_FILE)) {
      const data = fs.readFileSync(NOTES_FILE, 'utf8');
      existingNotes = JSON.parse(data);
    }

    // Merge notes (imported notes are added, duplicates by ID are skipped)
    const existingIds = new Set(existingNotes.map(n => n.id));
    const newNotes = importedNotes.filter(n => !existingIds.has(n.id));
    const mergedNotes = [...existingNotes, ...newNotes];

    // Save merged notes
    fs.writeFileSync(NOTES_FILE, JSON.stringify(mergedNotes, null, 2));

    return { 
      success: true, 
      imported: newNotes.length,
      skipped: importedNotes.length - newNotes.length,
      total: mergedNotes.length
    };
  } catch (error) {
    console.error('Error importing notes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-notes-location', async () => {
  return {
    path: NOTES_FILE,
    directory: app.getPath('userData')
  };
});

ipcMain.handle('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle('show-window', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

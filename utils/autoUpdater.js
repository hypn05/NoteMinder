const { autoUpdater } = require('electron-updater');
const { dialog, Notification, app } = require('electron');
const log = require('electron-log');

class AutoUpdater {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.isManualCheck = false;
    this.updateInfo = null;
    
    // Configure logging
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    
    // Configure auto-updater
    autoUpdater.autoDownload = false; // Don't auto-download, ask user first
    autoUpdater.autoInstallOnAppQuit = true; // Install when app quits
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    // Update available
    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info.version);
      this.updateAvailable = true;
      this.updateInfo = info;
      this.showUpdateAvailableDialog(info);
    });
    
    // Update not available
    autoUpdater.on('update-not-available', (info) => {
      this.updateAvailable = false;
      
      // Only show message for manual checks
      if (this.isManualCheck && this.mainWindow) {
        this.mainWindow.webContents.send('show-message', {
          type: 'success',
          message: 'You are running the latest version!'
        });
      }
      
      this.isManualCheck = false;
    });
    
    // Error occurred
    autoUpdater.on('error', (err) => {
      log.error('Error in auto-updater:', err);
      
      // Only show error message for manual checks
      if (this.isManualCheck && this.mainWindow) {
        this.mainWindow.webContents.send('show-message', {
          type: 'error',
          message: 'Unable to check for updates. Please try again later.'
        });
      }
      
      this.isManualCheck = false;
    });
    
    // Download progress
    autoUpdater.on('download-progress', (progressObj) => {
      // Send progress to renderer
      if (this.mainWindow) {
        this.mainWindow.webContents.send('download-progress', {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
          bytesPerSecond: progressObj.bytesPerSecond
        });
      }
    });
    
    // Update downloaded
    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info.version);
      this.updateDownloaded = true;
      this.showUpdateDownloadedDialog(info);
    });
  }
  
  showUpdateAvailableDialog(info) {
    // Show and focus the main window, and expand the sidebar
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
      this.mainWindow.webContents.send('expand-sidebar');
    }
    
    const options = {
      type: 'info',
      title: 'Update Available',
      message: `A new version ${info.version} is available!`,
      detail: `Current version: ${app.getVersion()}\nNew version: ${info.version}\n\nRelease date: ${new Date(info.releaseDate).toLocaleDateString()}\n\nWould you like to download it now?`,
      buttons: ['Download Now', 'View Release Notes', 'Later'],
      defaultId: 0,
      cancelId: 2
    };
    
    dialog.showMessageBox(this.mainWindow, options).then(result => {
      if (result.response === 0) {
        // Download Now
        this.downloadUpdate();
      } else if (result.response === 1) {
        // View Release Notes
        if (this.mainWindow) {
          this.mainWindow.webContents.send('show-release-notes', {
            version: info.version,
            releaseNotes: info.releaseNotes,
            releaseDate: info.releaseDate
          });
        }
        
        // Ask again after showing notes
        setTimeout(() => {
          const followUpOptions = {
            type: 'question',
            title: 'Download Update?',
            message: 'Would you like to download the update now?',
            buttons: ['Download', 'Later'],
            defaultId: 0,
            cancelId: 1
          };
          
          dialog.showMessageBox(this.mainWindow, followUpOptions).then(followUpResult => {
            if (followUpResult.response === 0) {
              this.downloadUpdate();
            }
          });
        }, 500);
      }
    });
    
    // Also show system notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'NoteMinder Update Available',
        body: `Version ${info.version} is ready to download!`,
        silent: false
      });
      
      notification.on('click', () => {
        this.downloadUpdate();
      });
      
      notification.show();
    }
  }
  
  showUpdateDownloadedDialog(info) {
    const options = {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded!`,
      detail: 'The update will be installed when you restart the application.\n\nWould you like to restart now?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    };
    
    dialog.showMessageBox(this.mainWindow, options).then(result => {
      if (result.response === 0) {
        // Restart and install
        autoUpdater.quitAndInstall(false, true);
      }
    });
    
    // Show system notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'NoteMinder Update Ready',
        body: `Version ${info.version} is ready to install. Restart to update.`,
        silent: false
      });
      
      notification.on('click', () => {
        autoUpdater.quitAndInstall(false, true);
      });
      
      notification.show();
    }
  }
  
  downloadUpdate() {
    // Show download progress notification
    if (this.mainWindow) {
      this.mainWindow.webContents.send('update-download-started');
    }
    
    autoUpdater.downloadUpdate();
  }
  
  // Check for updates manually
  async checkForUpdates(isManual = false) {
    try {
      this.isManualCheck = isManual;
      const result = await autoUpdater.checkForUpdates();
      
      // If update is available, return formatted info for main.js
      if (this.updateInfo) {
        return {
          currentVersion: app.getVersion(),
          latestVersion: this.updateInfo.version,
          releaseUrl: `https://github.com/hypn05/NoteMinder/releases/tag/v${this.updateInfo.version}`,
          releaseDate: this.updateInfo.releaseDate,
          releaseNotes: this.updateInfo.releaseNotes
        };
      }
      
      return null;
    } catch (error) {
      log.error('Error checking for updates:', error);
      
      // Show error message for manual checks
      if (isManual && this.mainWindow) {
        this.mainWindow.webContents.send('show-message', {
          type: 'error',
          message: 'Unable to check for updates. Please try again later.'
        });
      }
      
      this.isManualCheck = false;
      return null;
    }
  }
  
  // Start automatic update checks
  start() {
    // Check for updates on startup (after a short delay)
    setTimeout(() => {
      this.checkForUpdates();
    }, 3000);
    
    // Check for updates every 6 hours
    this.updateInterval = setInterval(() => {
      this.checkForUpdates();
    }, 6 * 60 * 60 * 1000);
  }
  
  // Stop automatic update checks
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  
  // Get current update status
  getStatus() {
    return {
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
      currentVersion: app.getVersion(),
      updateInfo: this.updateInfo
    };
  }
  
  // Install update if downloaded
  installUpdate() {
    if (this.updateDownloaded) {
      autoUpdater.quitAndInstall(false, true);
    } else {
      log.warn('No update downloaded to install');
    }
  }
}

module.exports = AutoUpdater;

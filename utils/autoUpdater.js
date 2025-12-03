const { dialog, Notification, app, shell, clipboard } = require('electron');
const https = require('https');

class AutoUpdater {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.updateAvailable = false;
    this.isManualCheck = false;
    this.updateInfo = null;
  }
  
  checkForUpdates(isManual = false) {
    this.isManualCheck = isManual;
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/hypn05/NoteMinder/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'NoteMinder-App'
        }
      };

      https.get(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace('v', '');
            const currentVersion = app.getVersion();
            
            if (this.compareVersions(latestVersion, currentVersion) > 0) {
              this.updateAvailable = true;
              this.updateInfo = {
                version: latestVersion,
                url: release.html_url,
                releaseDate: release.published_at,
                releaseNotes: release.body
              };
              
              this.showUpdateDialog(latestVersion, release.html_url);
              resolve({ 
                available: true, 
                version: latestVersion,
                currentVersion: currentVersion,
                latestVersion: latestVersion,
                releaseUrl: release.html_url,
                releaseDate: release.published_at,
                releaseNotes: release.body
              });
            } else {
              this.updateAvailable = false;
              
              // Only show message for manual checks
              if (isManual && this.mainWindow) {
                this.mainWindow.webContents.send('show-message', {
                  type: 'success',
                  message: 'You are running the latest version!'
                });
              }
              
              resolve({ available: false });
            }
            
            this.isManualCheck = false;
          } catch (error) {
            this.handleError(error);
            reject(error);
          }
        });
      }).on('error', (error) => {
        this.handleError(error);
        reject(error);
      });
    });
  }

  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
  }

  showUpdateDialog(version, url) {
    // Show and focus the main window, and expand the sidebar
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
      this.mainWindow.webContents.send('expand-sidebar');
    }
    
    const options = {
      type: 'info',
      title: 'Update Available',
      message: `NoteMinder v${version} is available!`,
      detail: `Current version: ${app.getVersion()}\nNew version: ${version}\n\nYou can update via:\n\n1. Homebrew: brew upgrade noteminder\n2. Direct download from GitHub\n\nClick a button below to proceed.`,
      buttons: ['Open GitHub', 'Copy Brew Command', 'Later'],
      defaultId: 0,
      cancelId: 2
    };

    dialog.showMessageBox(this.mainWindow, options).then(result => {
      if (result.response === 0) {
        // Open GitHub releases
        shell.openExternal(url);
      } else if (result.response === 1) {
        // Copy Homebrew command
        clipboard.writeText('brew upgrade noteminder');
        
        if (this.mainWindow) {
          this.mainWindow.webContents.send('show-message', {
            type: 'success',
            message: 'Brew command copied! Paste in terminal to update.'
          });
        }
      }
    });

    // Show system notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'NoteMinder Update Available',
        body: `Version ${version} is ready! Click to view release.`,
        silent: false
      });
      
      notification.on('click', () => {
        shell.openExternal(url);
      });
      
      notification.show();
    }
  }

  handleError(error) {
    console.error('Error checking for updates:', error);
    
    // Only show error message for manual checks
    if (this.isManualCheck && this.mainWindow) {
      this.mainWindow.webContents.send('show-message', {
        type: 'error',
        message: 'Unable to check for updates. Please try again later.'
      });
    }
    
    this.isManualCheck = false;
  }
  
  // Start automatic update checks
  start() {
    // Check for updates on startup (after a short delay)
    setTimeout(() => {
      this.checkForUpdates().catch(err => {
        console.error('Update check failed:', err);
      });
    }, 5000);
    
    // Check for updates every 6 hours
    this.updateInterval = setInterval(() => {
      this.checkForUpdates().catch(err => {
        console.error('Update check failed:', err);
      });
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
      currentVersion: app.getVersion(),
      updateInfo: this.updateInfo
    };
  }
}

module.exports = AutoUpdater;

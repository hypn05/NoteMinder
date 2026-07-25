const { dialog, Notification, app, shell, clipboard } = require('electron');
const https = require('https');

// electron-updater relies on a signed/notarized app to verify updates safely.
// We don't have a macOS signing certificate, so macOS keeps the old
// "notify and let the user grab it themselves" flow further down this file.
const SUPPORTS_SILENT_UPDATE = process.platform !== 'darwin';

class AutoUpdater {
  constructor(mainWindow, onStateChange) {
    this.mainWindow = mainWindow;
    this.onStateChange = onStateChange || (() => {});
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.isManualCheck = false;
    this.updateInfo = null;

    if (SUPPORTS_SILENT_UPDATE) {
      this._setupElectronUpdater();
    }
  }

  _setupElectronUpdater() {
    const { autoUpdater } = require('electron-updater');
    this.electronAutoUpdater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      this.updateAvailable = true;
      this.updateInfo = { version: info.version, releaseDate: info.releaseDate };
      this.onStateChange({ status: 'available', version: info.version, readyToInstall: false });

      if (this.isManualCheck && this.mainWindow) {
        this.mainWindow.webContents.send('show-message', {
          type: 'success',
          message: `Update v${info.version} found — downloading in the background…`
        });
      }
    });

    autoUpdater.on('update-not-available', () => {
      this.updateAvailable = false;
      // A stale "ready to install" shouldn't be cleared by a later check that
      // just confirms there's nothing newer than what's already downloaded.
      if (!this.updateDownloaded) {
        this.onStateChange(null);
      }

      if (this.isManualCheck && this.mainWindow) {
        this.mainWindow.webContents.send('show-message', {
          type: 'success',
          message: 'You are running the latest version!'
        });
      }

      this.isManualCheck = false;
    });

    autoUpdater.on('error', (error) => this.handleError(error));

    autoUpdater.on('download-progress', (progress) => {
      this.onStateChange({
        status: 'downloading',
        version: this.updateInfo && this.updateInfo.version,
        percent: Math.round(progress.percent),
        readyToInstall: false
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.updateDownloaded = true;
      this.updateInfo = { ...this.updateInfo, version: info.version };
      this.onStateChange({ status: 'ready', version: info.version, readyToInstall: true });
      this.showInstallPrompt(info.version);
    });
  }

  checkForUpdates(isManual = false) {
    this.isManualCheck = isManual;

    if (SUPPORTS_SILENT_UPDATE) {
      return this.electronAutoUpdater.checkForUpdates().catch((error) => {
        this.handleError(error);
      });
    }

    return this._checkGithubReleaseForMac();
  }

  // macOS: no code signing certificate, so we can't safely auto-download and
  // replace the running app. Just tell the user a new version exists and
  // point them at Homebrew (recommended) or a direct download.
  _checkGithubReleaseForMac() {
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

              this.onStateChange({ status: 'available', version: latestVersion, releaseUrl: release.html_url, readyToInstall: false });
              this.showMacUpdateDialog(latestVersion, release.html_url);
              resolve({
                available: true,
                version: latestVersion,
                currentVersion,
                latestVersion,
                releaseUrl: release.html_url,
                releaseDate: release.published_at,
                releaseNotes: release.body
              });
            } else {
              this.updateAvailable = false;
              this.onStateChange(null);

              if (this.isManualCheck && this.mainWindow) {
                this.mainWindow.webContents.send('show-message', {
                  type: 'success',
                  message: 'You are running the latest version!'
                });
              }

              resolve(null);
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

  showMacUpdateDialog(version, url) {
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
        shell.openExternal(url);
      } else if (result.response === 1) {
        clipboard.writeText('brew upgrade noteminder');

        if (this.mainWindow) {
          this.mainWindow.webContents.send('show-message', {
            type: 'success',
            message: 'Brew command copied! Paste in terminal to update.'
          });
        }
      }
    });

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

  // Windows/Linux: the update has already downloaded silently in the
  // background (autoDownload = true). All that's left is a restart.
  showInstallPrompt(version) {
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
      this.mainWindow.webContents.send('expand-sidebar');
    }

    const options = {
      type: 'info',
      title: 'Update Ready',
      message: `NoteMinder v${version} has been downloaded.`,
      detail: 'Restart now to install it, or it will install automatically the next time you quit NoteMinder.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    };

    dialog.showMessageBox(this.mainWindow, options).then(result => {
      if (result.response === 0) {
        this.quitAndInstall();
      }
    });

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'NoteMinder Update Ready',
        body: `Version ${version} downloaded. Click to restart and install.`,
        silent: false
      });

      notification.on('click', () => this.quitAndInstall());
      notification.show();
    }
  }

  quitAndInstall() {
    if (this.electronAutoUpdater) {
      this.electronAutoUpdater.quitAndInstall();
    }
  }

  handleError(error) {
    console.error('Error checking for updates:', error);

    if (this.isManualCheck && this.mainWindow) {
      this.mainWindow.webContents.send('show-message', {
        type: 'error',
        message: 'Unable to check for updates. Please try again later.'
      });
    }

    this.isManualCheck = false;
  }

  start() {
    setTimeout(() => {
      this.checkForUpdates().catch(err => {
        console.error('Update check failed:', err);
      });
    }, 5000);

    this.updateInterval = setInterval(() => {
      this.checkForUpdates().catch(err => {
        console.error('Update check failed:', err);
      });
    }, 6 * 60 * 60 * 1000);
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

module.exports = AutoUpdater;

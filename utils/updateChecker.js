const { app } = require('electron');
const https = require('https');

class UpdateChecker {
  constructor() {
    this.currentVersion = app.getVersion();
    this.githubRepo = 'hypn05/NoteMinder';
    this.checkInterval = 6 * 60 * 60 * 1000; // Check every 6 hours
    this.intervalId = null;
  }

  /**
   * Start periodic update checks
   */
  start() {
    // Check immediately on start
    this.checkForUpdates();
    
    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkForUpdates();
    }, this.checkInterval);
    
    console.log('[UpdateChecker] Started - checking every 6 hours');
  }

  /**
   * Stop periodic update checks
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[UpdateChecker] Stopped');
    }
  }

  /**
   * Check for updates from GitHub releases
   * @returns {Promise<Object|null>} Update info or null if no update available
   */
  async checkForUpdates() {
    try {
      console.log('[UpdateChecker] Checking for updates...');
      console.log('[UpdateChecker] Current version:', this.currentVersion);
      
      const latestRelease = await this.fetchLatestRelease();
      
      if (!latestRelease) {
        console.log('[UpdateChecker] No release information available');
        return null;
      }

      const latestVersion = latestRelease.tag_name.replace(/^v/, '');
      console.log('[UpdateChecker] Latest version:', latestVersion);

      if (this.isNewerVersion(latestVersion, this.currentVersion)) {
        console.log('[UpdateChecker] New version available!');
        
        const updateInfo = {
          currentVersion: this.currentVersion,
          latestVersion: latestVersion,
          releaseUrl: latestRelease.html_url,
          releaseNotes: latestRelease.body || 'No release notes available',
          publishedAt: latestRelease.published_at,
          assets: this.getRelevantAssets(latestRelease.assets)
        };

        return updateInfo;
      } else {
        console.log('[UpdateChecker] Already on latest version');
        return null;
      }
    } catch (error) {
      console.error('[UpdateChecker] Error checking for updates:', error.message);
      return null;
    }
  }

  /**
   * Fetch latest release from GitHub API
   * @returns {Promise<Object|null>}
   */
  fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.githubRepo}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'NoteMinder-UpdateChecker',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const release = JSON.parse(data);
              resolve(release);
            } catch (error) {
              reject(new Error('Failed to parse release data'));
            }
          } else if (res.statusCode === 404) {
            console.log('[UpdateChecker] No releases found');
            resolve(null);
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Compare version strings
   * @param {string} latest - Latest version string
   * @param {string} current - Current version string
   * @returns {boolean} True if latest is newer than current
   */
  isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;

      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }

    return false;
  }

  /**
   * Get relevant download assets based on platform
   * @param {Array} assets - Array of release assets
   * @returns {Array} Filtered assets for current platform
   */
  getRelevantAssets(assets) {
    if (!assets || !Array.isArray(assets)) {
      return [];
    }

    const platform = process.platform;
    const relevantAssets = [];

    assets.forEach(asset => {
      const name = asset.name.toLowerCase();
      
      // macOS
      if (platform === 'darwin' && (name.endsWith('.dmg') || name.endsWith('.zip'))) {
        relevantAssets.push({
          name: asset.name,
          size: asset.size,
          downloadUrl: asset.browser_download_url
        });
      }
      // Windows
      else if (platform === 'win32' && (name.endsWith('.exe') || name.endsWith('.msi'))) {
        relevantAssets.push({
          name: asset.name,
          size: asset.size,
          downloadUrl: asset.browser_download_url
        });
      }
      // Linux
      else if (platform === 'linux' && (name.endsWith('.appimage') || name.endsWith('.deb') || name.endsWith('.rpm'))) {
        relevantAssets.push({
          name: asset.name,
          size: asset.size,
          downloadUrl: asset.browser_download_url
        });
      }
    });

    return relevantAssets;
  }

  /**
   * Format file size for display
   * @param {number} bytes
   * @returns {string}
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = UpdateChecker;

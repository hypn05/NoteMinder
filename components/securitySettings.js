class SecuritySettings {
  constructor() {
    this.settings = {
      authenticationPolicy: 'always', // Options: 'always', 'once_per_session', 'after_idle'
      idleTimeout: 300, // Seconds before requiring re-auth (5 minutes)
      clipboardClearTimeout: 30, // Seconds before clearing copied password
      showEncryptionBadge: true, // Show lock icon on encrypted entries
      requireAuthForView: true, // Require auth to view passwords
      requireAuthForCopy: true // Require auth to copy credentials
    };
    
    this.loadSettings();
  }
  
  async loadSettings() {
    const { ipcRenderer } = require('electron');
    const saved = await ipcRenderer.invoke('get-security-settings');
    if (saved) {
      this.settings = { ...this.settings, ...saved };
    }
  }
  
  async saveSettings() {
    const { ipcRenderer } = require('electron');
    await ipcRenderer.invoke('save-security-settings', this.settings);
  }
  
  get(key) {
    return this.settings[key];
  }
  
  set(key, value) {
    this.settings[key] = value;
    this.saveSettings();
  }
  
  renderPanel() {
    const panel = document.createElement('div');
    panel.className = 'security-settings-panel';
    panel.style.maxWidth = '600px';
    
    panel.innerHTML = `
      <div class="settings-section">
        <h3 class="settings-section-title">Password Security Settings</h3>
        <p class="settings-section-description">
          Configure how NoteMinder handles password encryption and authentication.
        </p>
      </div>
      
      <div class="settings-section">
        <h4 class="settings-label">Authentication Policy</h4>
        <p class="settings-description">Control how frequently you need to authenticate when viewing/copying passwords</p>
        <select id="auth-policy" class="input">
          <option value="always" ${this.settings.authenticationPolicy === 'always' ? 'selected' : ''}>
            Always - Authenticate every time (Most Secure)
          </option>
          <option value="once_per_session" ${this.settings.authenticationPolicy === 'once_per_session' ? 'selected' : ''}>
            Once Per Session - Authenticate once until app restarts
          </option>
          <option value="after_idle" ${this.settings.authenticationPolicy === 'after_idle' ? 'selected' : ''}>
            After Idle - Re-authenticate after period of inactivity
          </option>
        </select>
      </div>
      
      <div class="settings-section" id="idle-timeout-section" style="${this.settings.authenticationPolicy === 'after_idle' ? '' : 'display: none;'}">
        <h4 class="settings-label">Idle Timeout</h4>
        <p class="settings-description">Minutes of inactivity before requiring re-authentication</p>
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="range" id="idle-timeout" class="slider" min="1" max="60" value="${this.settings.idleTimeout / 60}">
          <span id="idle-timeout-value" class="settings-value">${this.settings.idleTimeout / 60} minutes</span>
        </div>
      </div>
      
      <div class="settings-section">
        <h4 class="settings-label">Clipboard Clear Timeout</h4>
        <p class="settings-description">Seconds before clearing copied passwords from clipboard</p>
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="range" id="clipboard-timeout" class="slider" min="10" max="120" value="${this.settings.clipboardClearTimeout}">
          <span id="clipboard-timeout-value" class="settings-value">${this.settings.clipboardClearTimeout} seconds</span>
        </div>
      </div>
      
      <div class="settings-section">
        <h4 class="settings-label">Display Options</h4>
        <div class="checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" id="show-encryption-badge" ${this.settings.showEncryptionBadge ? 'checked' : ''}>
            <span>Show encryption badge (🔒) on password fields</span>
          </label>
        </div>
      </div>
      
      <div class="settings-section">
        <h4 class="settings-label">Authentication Requirements</h4>
        <div class="checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" id="require-auth-view" ${this.settings.requireAuthForView ? 'checked' : ''}>
            <span>Require authentication to view passwords</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="require-auth-copy" ${this.settings.requireAuthForCopy ? 'checked' : ''}>
            <span>Require authentication to copy credentials</span>
          </label>
        </div>
      </div>
      
      <div class="settings-section">
        <h4 class="settings-label">Encryption Information</h4>
        <div id="encryption-info" style="padding: 15px; background: var(--bg-secondary); border-radius: 4px; font-size: 13px; line-height: 1.6;">
          <div style="margin-bottom: 10px;">
            <strong>🔐 Encryption Status:</strong> <span id="encryption-status">Loading...</span>
          </div>
          <div style="margin-bottom: 10px;">
            <strong>🔑 Encryption Method:</strong> <span id="encryption-method">Loading...</span>
          </div>
          <div style="color: var(--text-secondary); font-size: 12px; margin-top: 10px;">
            ℹ️ Passwords are encrypted using your system's secure storage (macOS Keychain, Windows DPAPI, or Linux Secret Service). 
            Encrypted passwords are tied to this device and cannot be decrypted on other machines.
          </div>
        </div>
      </div>
      
      <div class="settings-section" style="border-top: 1px solid var(--border-color); padding-top: 20px;">
        <button id="test-auth" class="btn" style="width: 100%;">
          🔐 Test Authentication
        </button>
      </div>
    `;
    
    // Event listeners
    setTimeout(() => {
      this.attachEventListeners(panel);
      this.loadEncryptionInfo(panel);
    }, 0);
    
    return panel;
  }
  
  attachEventListeners(panel) {
    const authPolicySelect = panel.querySelector('#auth-policy');
    const idleTimeoutSection = panel.querySelector('#idle-timeout-section');
    const idleTimeoutSlider = panel.querySelector('#idle-timeout');
    const idleTimeoutValue = panel.querySelector('#idle-timeout-value');
    const clipboardTimeoutSlider = panel.querySelector('#clipboard-timeout');
    const clipboardTimeoutValue = panel.querySelector('#clipboard-timeout-value');
    const showBadgeCheckbox = panel.querySelector('#show-encryption-badge');
    const requireAuthViewCheckbox = panel.querySelector('#require-auth-view');
    const requireAuthCopyCheckbox = panel.querySelector('#require-auth-copy');
    const testAuthButton = panel.querySelector('#test-auth');
    
    // Authentication policy
    authPolicySelect.addEventListener('change', (e) => {
      this.set('authenticationPolicy', e.target.value);
      idleTimeoutSection.style.display = e.target.value === 'after_idle' ? '' : 'none';
    });
    
    // Idle timeout
    idleTimeoutSlider.addEventListener('input', (e) => {
      const minutes = parseInt(e.target.value);
      idleTimeoutValue.textContent = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
      this.set('idleTimeout', minutes * 60);
    });
    
    // Clipboard timeout
    clipboardTimeoutSlider.addEventListener('input', (e) => {
      const seconds = parseInt(e.target.value);
      clipboardTimeoutValue.textContent = `${seconds} second${seconds !== 1 ? 's' : ''}`;
      this.set('clipboardClearTimeout', seconds);
    });
    
    // Checkboxes
    showBadgeCheckbox.addEventListener('change', (e) => {
      this.set('showEncryptionBadge', e.target.checked);
    });
    
    requireAuthViewCheckbox.addEventListener('change', (e) => {
      this.set('requireAuthForView', e.target.checked);
    });
    
    requireAuthCopyCheckbox.addEventListener('change', (e) => {
      this.set('requireAuthForCopy', e.target.checked);
    });
    
    // Test authentication
    testAuthButton.addEventListener('click', async () => {
      const { ipcRenderer } = require('electron');
      testAuthButton.disabled = true;
      testAuthButton.textContent = '🔐 Authenticating...';
      
      try {
        const result = await ipcRenderer.invoke('request-system-auth', 'Test authentication');
        if (result.success) {
          testAuthButton.textContent = '✅ Authentication Successful';
          testAuthButton.style.backgroundColor = '#4caf50';
          testAuthButton.style.color = 'white';
          
          setTimeout(() => {
            testAuthButton.disabled = false;
            testAuthButton.textContent = '🔐 Test Authentication';
            testAuthButton.style.backgroundColor = '';
            testAuthButton.style.color = '';
          }, 2000);
        } else {
          testAuthButton.textContent = '❌ Authentication Failed';
          testAuthButton.style.backgroundColor = '#f44336';
          testAuthButton.style.color = 'white';
          
          setTimeout(() => {
            testAuthButton.disabled = false;
            testAuthButton.textContent = '🔐 Test Authentication';
            testAuthButton.style.backgroundColor = '';
            testAuthButton.style.color = '';
          }, 2000);
        }
      } catch (error) {
        console.error('Auth test error:', error);
        testAuthButton.disabled = false;
        testAuthButton.textContent = '🔐 Test Authentication';
      }
    });
  }
  
  async loadEncryptionInfo(panel) {
    const { ipcRenderer } = require('electron');
    const info = await ipcRenderer.invoke('get-encryption-info');
    
    const statusSpan = panel.querySelector('#encryption-status');
    const methodSpan = panel.querySelector('#encryption-method');
    
    if (info.available) {
      statusSpan.textContent = '✅ Active';
      statusSpan.style.color = '#4caf50';
      methodSpan.textContent = info.method;
    } else {
      statusSpan.textContent = '⚠️ Unavailable';
      statusSpan.style.color = '#ff9800';
      methodSpan.textContent = 'Plain text (encryption not available on this system)';
    }
  }
}

module.exports = SecuritySettings;

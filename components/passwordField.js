// Password field component for storing credentials with encryption
const { ipcRenderer } = require('electron');

// Global store for password field instances
const passwordFieldInstances = new Map();

class PasswordField {
  constructor(data = {}) {
    this.id = data.id || Date.now().toString();
    this.label = data.label || '';
    this.username = data.username || '';
    this.password = data.password || '';
    this.description = data.description || '';
    this.showPassword = false;
    this.encrypted = data.encrypted || false;
    this.element = null; // Store reference to rendered element
  }

  render() {
    const container = document.createElement('div');
    container.className = 'password-field-container';
    container.dataset.passwordId = this.id;
    container.contentEditable = 'false';
    
    // Store instance in global map
    passwordFieldInstances.set(this.id, this);
    this.element = container;
    
    const encryptionBadge = this.encrypted ? '<span style="font-size: 10px; opacity: 0.7; margin-left: 8px;">🔒 Encrypted</span>' : '';
    
    container.innerHTML = `
      <div class="password-field-header">
        <span class="password-field-icon">🔐</span>
        <span class="password-field-label">${this.escapeHtml(this.label || 'Password Entry')}${encryptionBadge}</span>
        <button class="password-field-delete" title="Delete password entry">✕</button>
      </div>
      <div class="password-field-content">
        ${this.description ? `
          <div class="password-field-row">
            <span class="password-field-key">Description:</span>
            <span class="password-field-value">${this.escapeHtml(this.description)}</span>
          </div>
        ` : ''}
        ${this.username ? `
          <div class="password-field-row">
            <span class="password-field-key">Username:</span>
            <span class="password-field-value">${this.escapeHtml(this.username)}</span>
            <button class="password-field-copy" data-copy-type="username" title="Copy username">📋</button>
          </div>
        ` : ''}
        ${this.password ? `
          <div class="password-field-row">
            <span class="password-field-key">Password:</span>
            <span class="password-field-value password-value ${this.showPassword ? '' : 'masked'}">
              ${this.showPassword ? this.escapeHtml(this.password) : '••••••••'}
            </span>
            <button class="password-field-toggle" title="Toggle password visibility">👁️</button>
            <button class="password-field-copy" data-copy-type="password" title="Copy password">📋</button>
          </div>
        ` : ''}
      </div>
    `;
    
    // Add event listeners
    this.attachEventListeners(container);
    
    return container;
  }

  attachEventListeners(container) {
    // Delete button
    const deleteBtn = container.querySelector('.password-field-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('Delete this password entry?')) {
        // Remove from global instances map
        passwordFieldInstances.delete(this.id);
        
        // Remove the element
        container.remove();
        
        // Mark note as modified
        if (window.notesApp && window.notesApp.currentNote) {
          window.notesApp.currentNote.modified = true;
        }
        
        // Trigger a change event for the editor to auto-save
        const editor = document.getElementById('editor');
        if (editor) {
          const event = new Event('input', { bubbles: true });
          editor.dispatchEvent(event);
        }
      }
    });

    // Toggle password visibility
    const toggleBtn = container.querySelector('.password-field-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Request system authentication before showing password
        const authResult = await ipcRenderer.invoke('request-system-auth', 'View password');
        if (!authResult.success) {
          this.showNotification('Authentication failed', 'error');
          return;
        }
        
        const valueSpan = container.querySelector('.password-value');
        const isCurrentlyMasked = valueSpan.classList.contains('masked');
        
        if (isCurrentlyMasked) {
          // Show the actual password from the instance
          valueSpan.textContent = this.password;
          valueSpan.classList.remove('masked');
          toggleBtn.textContent = '👁️‍🗨️';
          toggleBtn.title = 'Hide password';
        } else {
          valueSpan.textContent = '••••••••';
          valueSpan.classList.add('masked');
          toggleBtn.textContent = '👁️';
          toggleBtn.title = 'Show password';
        }
      });
    }

    // Copy buttons
    const copyButtons = container.querySelectorAll('.password-field-copy');
    copyButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const copyType = btn.dataset.copyType;
        
        // Request system authentication before copying
        const authResult = await ipcRenderer.invoke('request-system-auth', `Copy ${copyType}`);
        if (!authResult.success) {
          this.showNotification('Authentication required to copy credentials', 'error');
          return;
        }
        
        let textToCopy = '';
        
        if (copyType === 'username') {
          textToCopy = this.username;
        } else if (copyType === 'password') {
          textToCopy = this.password;
        }
        
        if (textToCopy) {
          try {
            await navigator.clipboard.writeText(textToCopy);
            
            // Visual feedback
            const originalText = btn.textContent;
            btn.textContent = '✓';
            btn.style.color = 'var(--success-color, #4caf50)';
            
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.color = '';
            }, 1500);
            
            this.showNotification(`${copyType} copied to clipboard`, 'success');
          } catch (err) {
            console.error('Failed to copy:', err);
            this.showNotification('Failed to copy to clipboard', 'error');
          }
        }
      });
    });
  }

  showNotification(message, type = 'info') {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3'};
      color: white;
      border-radius: 4px;
      z-index: 10000;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async toJSON() {
    // Return encrypted version for storage
    const data = {
      id: this.id,
      label: this.label,
      username: this.username,
      password: this.password,
      description: this.description,
      encrypted: false
    };
    
    // Encrypt the password entry
    try {
      const result = await ipcRenderer.invoke('encrypt-password-entry', data);
      if (result.success) {
        return result.data;
      }
    } catch (error) {
      console.error('Failed to encrypt password entry:', error);
    }
    
    // Return unencrypted if encryption fails
    return data;
  }

  static async fromJSON(data) {
    // Decrypt if encrypted
    if (data.encrypted) {
      try {
        const result = await ipcRenderer.invoke('decrypt-password-entry', data);
        if (result.success) {
          return new PasswordField(result.data);
        }
      } catch (error) {
        console.error('Failed to decrypt password entry:', error);
        // Return placeholder if decryption fails
        return new PasswordField({
          id: data.id,
          label: data.label + ' (Decryption failed)',
          username: '',
          password: '',
          description: data.description || 'Unable to decrypt credentials'
        });
      }
    }
    
    return new PasswordField(data);
  }

  static fromElement(element) {
    const id = element.dataset.passwordId;
    const label = element.querySelector('.password-field-label')?.textContent.split('🔒')[0].trim() || '';
    const descriptionEl = element.querySelector('.password-field-row:has(.password-field-key:contains("Description"))');
    const description = descriptionEl?.querySelector('.password-field-value')?.textContent || '';
    const usernameEl = element.querySelector('.password-field-row:has([data-copy-type="username"])');
    const username = usernameEl?.querySelector('.password-field-value')?.textContent || '';
    const passwordEl = element.querySelector('.password-value');
    const password = passwordEl?.dataset.password || '';
    
    return new PasswordField({
      id,
      label,
      username,
      password,
      description
    });
  }
}

// Add CSS for toast animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

module.exports = PasswordField;

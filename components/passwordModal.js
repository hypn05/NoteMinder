// PasswordModal component for creating/editing password entries
const { ipcRenderer } = require('electron');
const Modal = require('./modal');

class PasswordModal {
  constructor() {
    this.modal = new Modal();
    this.currentPassword = null;
    this.isEditMode = false;
  }

  async show(password = null) {
    this.isEditMode = !!password;
    this.currentPassword = password;
    
    let decryptedData = null;
    
    if (this.isEditMode) {
      // Request authentication and decrypt
      const authResult = await ipcRenderer.invoke('request-system-auth', 'View password details');
      if (!authResult.success) {
        this.showNotification('Authentication required', 'error');
        return null;
      }
      
      const result = await ipcRenderer.invoke('decrypt-password-entry', password);
      if (!result.success) {
        this.showNotification('Failed to decrypt password', 'error');
        return null;
      }
      decryptedData = result.data;
    }
    
    const content = this.createForm(decryptedData);
    const title = this.isEditMode ? 'Edit Password' : 'New Password';
    this.modal.create(title, content);
    
    // Focus the first input
    setTimeout(() => {
      const firstInput = content.querySelector('#pwd-modal-label');
      if (firstInput) firstInput.focus();
    }, 100);
    
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  createForm(data = null) {
    const container = document.createElement('div');
    container.style.maxWidth = '600px';
    container.style.maxHeight = '70vh';
    container.style.overflowY = 'auto';
    
    const form = document.createElement('form');
    form.id = 'password-modal-form';
    
    const categories = ['General', 'Social Media', 'Email', 'Banking', 'Work', 'Shopping', 'Entertainment', 'Gaming', 'Developer', 'Other'];
    
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">Label *</label>
        <input type="text" id="pwd-modal-label" class="input" placeholder="e.g., Gmail Account" value="${this.escapeHtml(data?.label || '')}" required>
      </div>
      
      <div class="form-group">
        <label class="form-label">Category</label>
        <select id="pwd-modal-category" class="input">
          ${categories.map(cat => `<option value="${cat}" ${data?.category === cat ? 'selected' : ''}>${cat}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label class="form-label">Username/Email</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="text" id="pwd-modal-username" class="input" placeholder="username@example.com" value="${this.escapeHtml(data?.username || '')}" style="flex: 1; height: 36px;">
          <button type="button" id="copy-username-btn" class="btn" style="height: 36px; width: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;" title="Copy username">📋</button>
        </div>
      </div>
      
      <div class="form-group">
        <label class="form-label">Password *</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="password" id="pwd-modal-password" class="input" placeholder="Enter password" value="${this.escapeHtml(data?.password || '')}" required style="flex: 1; height: 36px;">
          <button type="button" id="toggle-password-btn" class="btn" style="height: 36px; width: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;" title="Toggle visibility">👁️</button>
          <button type="button" id="generate-password-btn" class="btn" style="height: 36px; width: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;" title="Generate password">🎲</button>
          <button type="button" id="copy-password-btn" class="btn" style="height: 36px; width: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;" title="Copy password">📋</button>
        </div>
        <div id="password-strength" style="margin-top: 8px; font-size: 12px;"></div>
      </div>
      
      <div class="form-group">
        <label class="form-label">Website URL</label>
        <input type="url" id="pwd-modal-url" class="input" placeholder="https://example.com" value="${this.escapeHtml(data?.url || '')}">
      </div>
      
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea id="pwd-modal-description" class="input" placeholder="Optional notes about this password" rows="3">${this.escapeHtml(data?.description || '')}</textarea>
      </div>
      
      <div style="display: flex; gap: 10px; margin-top: 20px; align-items: center;">
        <button type="submit" class="btn btn-primary" style="flex: 1; height: 36px; display: inline-flex; align-items: center; justify-content: center; line-height: 1;">${this.isEditMode ? 'Update Password' : 'Create Password'}</button>
        <button type="button" id="cancel-btn" class="btn" style="height: 36px; padding: 0 16px; display: inline-flex; align-items: center; justify-content: center; line-height: 1;">Cancel</button>
        ${this.isEditMode ? '<button type="button" id="delete-btn" class="btn" style="padding: 8px 16px; background: var(--danger-color, #f44336);">Delete</button>' : ''}
      </div>
    `;
    
    container.appendChild(form);
    
    // Event listeners
    this.attachEventListeners(form, data);
    
    return container;
  }

  attachEventListeners(form, data) {
    const passwordInput = form.querySelector('#pwd-modal-password');
    const toggleBtn = form.querySelector('#toggle-password-btn');
    const generateBtn = form.querySelector('#generate-password-btn');
    const copyUsernameBtn = form.querySelector('#copy-username-btn');
    const copyPasswordBtn = form.querySelector('#copy-password-btn');
    const strengthDiv = form.querySelector('#password-strength');
    const cancelBtn = form.querySelector('#cancel-btn');
    const deleteBtn = form.querySelector('#delete-btn');
    
    // Toggle password visibility
    toggleBtn.addEventListener('click', () => {
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.textContent = '👁️‍🗨️';
        toggleBtn.title = 'Hide password';
      } else {
        passwordInput.type = 'password';
        toggleBtn.textContent = '👁️';
        toggleBtn.title = 'Show password';
      }
    });
    
    // Generate password
    generateBtn.addEventListener('click', async () => {
      const result = await ipcRenderer.invoke('generate-password', 16, {
        uppercase: true,
        lowercase: true,
        numbers: true,
        symbols: true
      });
      
      if (result.success) {
        passwordInput.value = result.password;
        passwordInput.type = 'text';
        toggleBtn.textContent = '👁️‍🗨️';
        this.updatePasswordStrength(result.password, strengthDiv);
      }
    });
    
    // Copy username
    copyUsernameBtn.addEventListener('click', async () => {
      const username = form.querySelector('#pwd-modal-username').value;
      if (username) {
        await this.copyToClipboard(username, 'Username');
      }
    });
    
    // Copy password
    copyPasswordBtn.addEventListener('click', async () => {
      const password = passwordInput.value;
      if (password) {
        await this.copyToClipboard(password, 'Password');
      }
    });
    
    // Password strength indicator
    passwordInput.addEventListener('input', (e) => {
      this.updatePasswordStrength(e.target.value, strengthDiv);
    });
    
    // Initial strength check if editing
    if (data?.password) {
      this.updatePasswordStrength(data.password, strengthDiv);
    }
    
    // Cancel button
    cancelBtn.addEventListener('click', () => {
      this.modal.close();
      if (this.resolvePromise) {
        this.resolvePromise(null);
      }
    });
    
    // Delete button (edit mode only)
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete this password? This action cannot be undone.')) {
          if (this.resolvePromise) {
            this.resolvePromise({ action: 'delete', id: this.currentPassword.id });
          }
          this.modal.close();
        }
      });
    }
    
    // Form submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const passwordData = {
        label: form.querySelector('#pwd-modal-label').value,
        category: form.querySelector('#pwd-modal-category').value,
        username: form.querySelector('#pwd-modal-username').value,
        password: passwordInput.value,
        url: form.querySelector('#pwd-modal-url').value,
        description: form.querySelector('#pwd-modal-description').value
      };
      
      if (this.isEditMode) {
        passwordData.id = this.currentPassword.id;
      }
      
      if (this.resolvePromise) {
        this.resolvePromise({
          action: this.isEditMode ? 'update' : 'create',
          data: passwordData
        });
      }
      
      this.modal.close();
    });
  }

  updatePasswordStrength(password, strengthDiv) {
    if (!password) {
      strengthDiv.textContent = '';
      strengthDiv.style.color = '';
      return;
    }
    
    let strength = 0;
    let feedback = [];
    
    // Length check
    if (password.length >= 12) strength += 2;
    else if (password.length >= 8) strength += 1;
    else feedback.push('Use at least 8 characters');
    
    // Character variety
    if (/[a-z]/.test(password)) strength += 1;
    if (/[A-Z]/.test(password)) strength += 1;
    if (/[0-9]/.test(password)) strength += 1;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 1;
    
    if (!/[a-z]/.test(password)) feedback.push('Add lowercase letters');
    if (!/[A-Z]/.test(password)) feedback.push('Add uppercase letters');
    if (!/[0-9]/.test(password)) feedback.push('Add numbers');
    if (!/[^a-zA-Z0-9]/.test(password)) feedback.push('Add symbols');
    
    let strengthText = '';
    let color = '';
    
    if (strength >= 5) {
      strengthText = '🟢 Strong password';
      color = '#4caf50';
    } else if (strength >= 3) {
      strengthText = '🟡 Moderate password';
      color = '#ff9800';
    } else {
      strengthText = '🔴 Weak password';
      color = '#f44336';
    }
    
    if (feedback.length > 0) {
      strengthText += ' - ' + feedback.join(', ');
    }
    
    strengthDiv.textContent = strengthText;
    strengthDiv.style.color = color;
  }

  async copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      this.showNotification(`${label} copied to clipboard`, 'success');
    } catch (err) {
      console.error('Failed to copy:', err);
      this.showNotification('Failed to copy to clipboard', 'error');
    }
  }

  showNotification(message, type = 'info') {
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
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

module.exports = PasswordModal;

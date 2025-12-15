// Password Manager - Handles standalone password entities
const { ipcRenderer } = require('electron');

class PasswordManager {
  constructor() {
    this.passwords = [];
  }

  async loadPasswords() {
    try {
      const result = await ipcRenderer.invoke('get-passwords');
      const encryptedPasswords = result || [];
      
      // Decrypt all passwords for display
      const decryptedPasswords = [];
      for (const password of encryptedPasswords) {
        if (password.encrypted) {
          const decryptResult = await ipcRenderer.invoke('decrypt-password-entry', password);
          if (decryptResult.success) {
            decryptedPasswords.push(decryptResult.data);
          } else {
            // If decryption fails, keep the encrypted version but clear sensitive fields
            decryptedPasswords.push({
              ...password,
              username: '',
              password: '',
              description: password.description || ''
            });
          }
        } else {
          decryptedPasswords.push(password);
        }
      }
      
      this.passwords = decryptedPasswords;
      return this.passwords;
    } catch (error) {
      console.error('Failed to load passwords:', error);
      this.passwords = [];
      return [];
    }
  }

  async savePasswords() {
    try {
      await ipcRenderer.invoke('save-passwords', this.passwords);
      return true;
    } catch (error) {
      console.error('Failed to save passwords:', error);
      return false;
    }
  }

  async createPassword(passwordData) {
    const password = {
      id: Date.now().toString(),
      label: passwordData.label || 'Untitled',
      username: passwordData.username || '',
      password: passwordData.password || '',
      description: passwordData.description || '',
      url: passwordData.url || '',
      category: passwordData.category || 'General',
      isFavorite: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    // Encrypt the password entry
    try {
      const result = await ipcRenderer.invoke('encrypt-password-entry', password);
      if (result.success) {
        this.passwords.unshift(result.data);
        await this.savePasswords();
        return { success: true, password: result.data };
      }
    } catch (error) {
      console.error('Failed to encrypt password:', error);
    }

    return { success: false, error: 'Failed to encrypt password' };
  }

  async updatePassword(id, updates) {
    const index = this.passwords.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, error: 'Password not found' };
    }

    // Decrypt first
    let decryptedData;
    if (this.passwords[index].encrypted) {
      const result = await ipcRenderer.invoke('decrypt-password-entry', this.passwords[index]);
      if (!result.success) {
        return { success: false, error: 'Failed to decrypt password' };
      }
      decryptedData = result.data;
    } else {
      decryptedData = this.passwords[index];
    }

    // Apply updates
    const updatedPassword = {
      ...decryptedData,
      ...updates,
      id: decryptedData.id, // Don't allow ID changes
      created: decryptedData.created, // Don't allow created date changes
      updated: new Date().toISOString()
    };

    // Re-encrypt
    const encryptResult = await ipcRenderer.invoke('encrypt-password-entry', updatedPassword);
    if (encryptResult.success) {
      this.passwords[index] = encryptResult.data;
      await this.savePasswords();
      return { success: true, password: encryptResult.data };
    }

    return { success: false, error: 'Failed to encrypt updated password' };
  }

  async deletePassword(id) {
    const index = this.passwords.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, error: 'Password not found' };
    }

    this.passwords.splice(index, 1);
    await this.savePasswords();
    return { success: true };
  }

  async toggleFavorite(id) {
    const index = this.passwords.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, error: 'Password not found' };
    }

    // Need to decrypt, toggle, re-encrypt
    let decryptedData;
    if (this.passwords[index].encrypted) {
      const result = await ipcRenderer.invoke('decrypt-password-entry', this.passwords[index]);
      if (!result.success) {
        return { success: false, error: 'Failed to decrypt password' };
      }
      decryptedData = result.data;
    } else {
      decryptedData = this.passwords[index];
    }

    decryptedData.isFavorite = !decryptedData.isFavorite;

    // Re-encrypt
    const encryptResult = await ipcRenderer.invoke('encrypt-password-entry', decryptedData);
    if (encryptResult.success) {
      this.passwords[index] = encryptResult.data;
      await this.savePasswords();
      return { success: true, password: encryptResult.data };
    }

    return { success: false, error: 'Failed to update password' };
  }

  async getDecryptedPassword(id) {
    const password = this.passwords.find(p => p.id === id);
    if (!password) {
      return { success: false, error: 'Password not found' };
    }

    if (password.encrypted) {
      return await ipcRenderer.invoke('decrypt-password-entry', password);
    }

    return { success: true, data: password };
  }

  searchPasswords(query) {
    if (!query) return this.passwords;

    const lowerQuery = query.toLowerCase();
    return this.passwords.filter(password => {
      // Search in label only (don't expose credentials in search)
      if (password.encrypted) {
        // For encrypted passwords, search in the visible label field
        return password.label && password.label.toLowerCase().includes(lowerQuery);
      }
      return password.label.toLowerCase().includes(lowerQuery);
    });
  }
}

module.exports = PasswordManager;

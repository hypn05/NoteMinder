const { safeStorage } = require('electron');
const crypto = require('crypto');

/**
 * Security Manager for encrypting/decrypting sensitive data
 * Uses Electron's safeStorage which integrates with:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: Secret Service API/libsecret
 */
class SecurityManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.saltLength = 64;
    this.tagLength = 16;
    
    // Check if encryption is available
    this.isAvailable = safeStorage.isEncryptionAvailable();
    
    if (!this.isAvailable) {
      console.warn('[Security] System encryption not available - passwords will not be fully secured');
    }
  }

  /**
   * Encrypt sensitive data using system keychain
   * @param {string} plaintext - The data to encrypt
   * @returns {string} Base64 encoded encrypted data
   */
  encrypt(plaintext) {
    if (!this.isAvailable) {
      // Fallback: basic encoding (NOT SECURE, just obfuscation)
      return 'UNSECURED:' + Buffer.from(plaintext).toString('base64');
    }

    try {
      // Use Electron's safeStorage which integrates with OS keychain
      const encrypted = safeStorage.encryptString(plaintext);
      return encrypted.toString('base64');
    } catch (error) {
      console.error('[Security] Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} ciphertext - Base64 encoded encrypted data
   * @returns {string} Decrypted plaintext
   */
  decrypt(ciphertext) {
    if (ciphertext.startsWith('UNSECURED:')) {
      // Handle fallback encoding
      const encoded = ciphertext.substring(10);
      return Buffer.from(encoded, 'base64').toString('utf-8');
    }

    if (!this.isAvailable) {
      throw new Error('System encryption not available');
    }

    try {
      const buffer = Buffer.from(ciphertext, 'base64');
      const decrypted = safeStorage.decryptString(buffer);
      return decrypted;
    } catch (error) {
      console.error('[Security] Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Encrypt password entry data
   * @param {Object} passwordData - Password entry object
   * @returns {Object} Encrypted password entry
   */
  encryptPasswordEntry(passwordData) {
    const encrypted = {
      id: passwordData.id,
      label: passwordData.label,
      description: passwordData.description,
      encrypted: true
    };

    // Encrypt sensitive fields
    if (passwordData.username) {
      encrypted.username = this.encrypt(passwordData.username);
    }
    if (passwordData.password) {
      encrypted.password = this.encrypt(passwordData.password);
    }

    return encrypted;
  }

  /**
   * Decrypt password entry data
   * @param {Object} encryptedData - Encrypted password entry object
   * @returns {Object} Decrypted password entry
   */
  decryptPasswordEntry(encryptedData) {
    if (!encryptedData.encrypted) {
      // Data is not encrypted, return as-is
      return encryptedData;
    }

    const decrypted = {
      id: encryptedData.id,
      label: encryptedData.label,
      description: encryptedData.description
    };

    try {
      // Decrypt sensitive fields
      if (encryptedData.username) {
        decrypted.username = this.decrypt(encryptedData.username);
      }
      if (encryptedData.password) {
        decrypted.password = this.decrypt(encryptedData.password);
      }
    } catch (error) {
      console.error('[Security] Failed to decrypt password entry:', error);
      throw error;
    }

    return decrypted;
  }

  /**
   * Verify if the system can decrypt data
   * This will trigger OS authentication prompt on macOS
   * @returns {Promise<boolean>}
   */
  async verifyAccess() {
    if (!this.isAvailable) {
      return false;
    }

    try {
      // Test encryption/decryption with a dummy value
      const testData = 'access_test';
      const encrypted = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted);
      return decrypted === testData;
    } catch (error) {
      console.error('[Security] Access verification failed:', error);
      return false;
    }
  }

  /**
   * Generate a random password
   * @param {number} length - Password length
   * @param {Object} options - Password generation options
   * @returns {string}
   */
  generatePassword(length = 16, options = {}) {
    const {
      includeUppercase = true,
      includeLowercase = true,
      includeNumbers = true,
      includeSymbols = true
    } = options;

    let charset = '';
    if (includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeNumbers) charset += '0123456789';
    if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (!charset) {
      charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    }

    let password = '';
    const randomBytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
      password += charset[randomBytes[i] % charset.length];
    }

    return password;
  }

  /**
   * Hash data (for verification, not encryption)
   * @param {string} data
   * @returns {string}
   */
  hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if encryption is available
   * @returns {boolean}
   */
  isEncryptionAvailable() {
    return this.isAvailable;
  }

  /**
   * Get encryption info for display
   * @returns {Object}
   */
  getEncryptionInfo() {
    return {
      available: this.isAvailable,
      method: this.isAvailable ? 'System Keychain' : 'None (Fallback)',
      platform: process.platform,
      description: this.getSystemDescription()
    };
  }

  getSystemDescription() {
    if (!this.isAvailable) {
      return 'Encryption not available on this system';
    }

    switch (process.platform) {
      case 'darwin':
        return 'Using macOS Keychain for secure storage';
      case 'win32':
        return 'Using Windows DPAPI for secure storage';
      case 'linux':
        return 'Using Linux Secret Service for secure storage';
      default:
        return 'Using system encryption';
    }
  }
}

module.exports = SecurityManager;

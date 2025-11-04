// Reusable storage utility for managing notes and settings
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class Storage {
  constructor(filename) {
    this.userDataPath = app.getPath('userData');
    this.filePath = path.join(this.userDataPath, filename);
  }

  read() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const data = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading ${this.filePath}:`, error);
      return null;
    }
  }

  write(data) {
    try {
      if (!fs.existsSync(this.userDataPath)) {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error(`Error writing ${this.filePath}:`, error);
      return false;
    }
  }
}

module.exports = Storage;

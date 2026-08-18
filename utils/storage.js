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
      // The primary file is corrupt (e.g. interrupted write from an older
      // version). Fall back to the .bak left by the atomic writer before
      // giving up on the user's data.
      const bakPath = this.filePath + '.bak';
      try {
        if (fs.existsSync(bakPath)) {
          const backup = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
          console.warn(`Recovered ${this.filePath} from backup after read failure`);
          return backup;
        }
      } catch (backupError) {
        console.error(`Error reading backup ${bakPath}:`, backupError);
      }
      console.error(`Error reading ${this.filePath}:`, error);
      return null;
    }
  }

  write(data) {
    try {
      if (!fs.existsSync(this.userDataPath)) {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      }
      const payload = JSON.stringify(data, null, 2);

      // Atomic write: a crash mid-writeFileSync would leave a truncated,
      // unparseable JSON file — for a notes app that's total data loss.
      // Write to a temp file, back up the current file, then rename over it
      // (rename is atomic on all supported platforms).
      const tmpPath = this.filePath + '.tmp';
      const bakPath = this.filePath + '.bak';

      fs.writeFileSync(tmpPath, payload, 'utf8');

      if (fs.existsSync(this.filePath)) {
        try {
          fs.copyFileSync(this.filePath, bakPath);
        } catch (backupError) {
          console.error(`Error backing up ${this.filePath}:`, backupError);
          // Continue anyway — losing the backup is better than losing the save.
        }
      }

      fs.renameSync(tmpPath, this.filePath);
      return true;
    } catch (error) {
      console.error(`Error writing ${this.filePath}:`, error);
      return false;
    }
  }
}

module.exports = Storage;

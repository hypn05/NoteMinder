// Clip Manager - Handles saved clipboard snippets
const { ipcRenderer } = require('electron');

class ClipManager {
  constructor() {
    this.clips = [];
  }

  async loadClips() {
    try {
      this.clips = await ipcRenderer.invoke('get-clips') || [];
      return this.clips;
    } catch (error) {
      console.error('Failed to load clips:', error);
      this.clips = [];
      return [];
    }
  }

  async saveClips() {
    try {
      await ipcRenderer.invoke('save-clips', this.clips);
      return true;
    } catch (error) {
      console.error('Failed to save clips:', error);
      return false;
    }
  }

  // Reads the OS clipboard (main process) and saves it as a new clip
  async captureFromClipboard() {
    const result = await ipcRenderer.invoke('capture-clipboard-clip');
    if (result.success) {
      await this.loadClips();
    }
    return result;
  }

  async deleteClip(id) {
    this.clips = this.clips.filter(c => c.id !== id);
    await this.saveClips();
  }
}

module.exports = ClipManager;

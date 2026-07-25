const { ipcRenderer } = require('electron');
const keybindings = require('../utils/keybindingsStore');

const GROUP_ORDER = ['Global', 'Navigation', 'Formatting', 'Blocks'];

class SettingsPanel {
  constructor({ notes, showMessage }) {
    this.getNotes = notes; // () => current notes array, for Export Now
    this.showMessage = showMessage || (() => {});
    this.recordingActionId = null;
    this.recordingHandler = null;
  }

  renderPanel() {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    panel.appendChild(this.renderShortcutsSection());
    panel.appendChild(this.renderSyncSection());

    return panel;
  }

  destroy() {
    this._stopRecording();
  }

  // ---- Keyboard shortcuts ----

  renderShortcutsSection() {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const header = document.createElement('div');
    header.className = 'settings-section-header';
    header.innerHTML = `
      <h3 class="settings-section-title">Keyboard Shortcuts</h3>
      <button class="btn btn-small" id="reset-all-shortcuts">Reset All</button>
    `;
    section.appendChild(header);

    const desc = document.createElement('p');
    desc.className = 'settings-description';
    desc.textContent = 'Click Change, then press the new key combo. Global shortcuts work from any app; the rest apply while NoteMinder is focused.';
    section.appendChild(desc);

    const groups = keybindings.getAllForUI();
    GROUP_ORDER.forEach((groupName) => {
      const items = groups[groupName];
      if (!items || items.length === 0) return;

      const subgroup = document.createElement('div');
      subgroup.className = 'settings-subgroup';

      const title = document.createElement('h4');
      title.className = 'settings-subgroup-title';
      title.textContent = groupName;
      subgroup.appendChild(title);

      items.forEach((item) => {
        subgroup.appendChild(this.renderKeybindRow(item));
      });

      section.appendChild(subgroup);
    });

    setTimeout(() => {
      const resetAllBtn = section.querySelector('#reset-all-shortcuts');
      resetAllBtn.addEventListener('click', async () => {
        this._stopRecording();
        await keybindings.resetAll();
        this._refreshAllRows(section);
        this.showMessage('All shortcuts reset to defaults', 'success');
      });
    }, 0);

    return section;
  }

  renderKeybindRow(item) {
    const row = document.createElement('div');
    row.className = 'keybind-row';
    row.dataset.actionId = item.id;

    row.innerHTML = `
      <span class="keybind-label">${item.label}</span>
      <span class="keybind-pill">${item.display}</span>
      <button class="btn btn-small keybind-change">Change</button>
      <button class="btn btn-small keybind-reset ${item.isCustom ? '' : 'hidden'}">Reset</button>
    `;

    setTimeout(() => {
      row.querySelector('.keybind-change').addEventListener('click', () => this._startRecording(item.id, row));
      row.querySelector('.keybind-reset').addEventListener('click', async () => {
        await keybindings.resetBinding(item.id);
        this._updateRow(row, item.id);
      });
    }, 0);

    return row;
  }

  _updateRow(row, actionId) {
    const groups = keybindings.getAllForUI();
    const all = Object.values(groups).flat();
    const item = all.find((a) => a.id === actionId);
    if (!item) return;

    row.querySelector('.keybind-pill').textContent = item.display;
    row.querySelector('.keybind-pill').classList.remove('keybind-error');
    row.querySelector('.keybind-reset').classList.toggle('hidden', !item.isCustom);
  }

  _refreshAllRows(section) {
    section.querySelectorAll('.keybind-row').forEach((row) => {
      this._updateRow(row, row.dataset.actionId);
    });
  }

  _startRecording(actionId, row) {
    this._stopRecording();
    this.recordingActionId = actionId;

    const pill = row.querySelector('.keybind-pill');
    const previousText = pill.textContent;
    pill.textContent = 'Press a key… (Esc to cancel)';
    pill.classList.add('keybind-recording');

    const handler = async (e) => {
      if (keybindings.isModifierKey(e.key)) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        this._stopRecording();
        pill.textContent = previousText;
        pill.classList.remove('keybind-recording');
        return;
      }

      const binding = keybindings.captureFromEvent(e);
      if (!binding) {
        pill.textContent = 'Unsupported key — try a letter, digit, / or Space';
        pill.classList.add('keybind-error');
        return;
      }

      const result = await keybindings.setBinding(actionId, binding);
      if (!result.success) {
        pill.textContent = result.error;
        pill.classList.add('keybind-error');
        return;
      }

      this._stopRecording();
      this._updateRow(row, actionId);
      this.showMessage('Shortcut updated', 'success');
    };

    this.recordingHandler = handler;
    document.addEventListener('keydown', handler, true);
  }

  _stopRecording() {
    if (this.recordingHandler) {
      document.removeEventListener('keydown', this.recordingHandler, true);
      this.recordingHandler = null;
    }
    this.recordingActionId = null;
  }

  // ---- Notes backup / sync ----

  renderSyncSection() {
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.innerHTML = `
      <h3 class="settings-section-title">Notes Backup / Sync</h3>
      <p class="settings-description">
        Export every note as a plain .md file into a folder you choose — point it at a Dropbox,
        iCloud Drive, or Syncthing folder to back it up or read it elsewhere. One-way (app → folder);
        edits made to the exported files aren't read back in.
      </p>
      <div class="settings-field-row">
        <input type="text" id="sync-folder-path" class="input" readonly placeholder="No folder selected">
        <button id="choose-sync-folder" class="btn btn-small">Browse…</button>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="sync-auto-export">
        <span>Automatically export after every save</span>
      </label>
      <div class="settings-row">
        <button id="export-now" class="btn btn-primary btn-small">Export Now</button>
        <span id="sync-last-export" class="settings-hint"></span>
      </div>
    `;

    setTimeout(() => this._wireSyncSection(section), 0);
    return section;
  }

  async _wireSyncSection(section) {
    const folderInput = section.querySelector('#sync-folder-path');
    const autoExportCheckbox = section.querySelector('#sync-auto-export');
    const lastExportLabel = section.querySelector('#sync-last-export');
    const chooseBtn = section.querySelector('#choose-sync-folder');
    const exportNowBtn = section.querySelector('#export-now');

    const settings = await ipcRenderer.invoke('get-sync-settings');
    folderInput.value = settings.folderPath || '';
    autoExportCheckbox.checked = !!settings.autoExport;
    this._renderLastExport(lastExportLabel, settings.lastExportAt);

    chooseBtn.addEventListener('click', async () => {
      const result = await ipcRenderer.invoke('choose-sync-folder');
      if (result.success) {
        folderInput.value = result.folderPath;
        this.showMessage('Export folder set', 'success');
      }
    });

    autoExportCheckbox.addEventListener('change', async (e) => {
      await ipcRenderer.invoke('save-sync-settings', { autoExport: e.target.checked });
    });

    exportNowBtn.addEventListener('click', async () => {
      if (!folderInput.value) {
        this.showMessage('Choose a folder first', 'error');
        return;
      }
      const result = await this.exportNow();
      if (result.success) {
        this._renderLastExport(lastExportLabel, result.lastExportAt);
        this.showMessage(`Exported ${result.count} note${result.count === 1 ? '' : 's'}`, 'success');
      } else {
        this.showMessage(result.error || 'Export failed', 'error');
      }
    });
  }

  _renderLastExport(el, lastExportAt) {
    el.textContent = lastExportAt
      ? `Last exported ${new Date(lastExportAt).toLocaleString()}`
      : 'Never exported yet';
  }

  async exportNow() {
    const { exportNotes } = require('../utils/markdownExport');
    return exportNotes(this.getNotes());
  }
}

module.exports = SettingsPanel;

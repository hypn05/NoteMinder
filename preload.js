const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadNotes: () => ipcRenderer.invoke('load-notes'),
  saveNotes: (notes) => ipcRenderer.invoke('save-notes', notes),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  scheduleReminder: (reminder) => ipcRenderer.invoke('schedule-reminder', reminder),
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  onNotificationClick: (callback) => ipcRenderer.on('notification-clicked', (event, noteId) => callback(noteId)),
  onCreateNewNote: (callback) => ipcRenderer.on('create-new-note', () => callback()),
  onNotesImported: (callback) => ipcRenderer.on('notes-imported', () => callback()),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  getWindowSize: () => ipcRenderer.invoke('get-window-size'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (event, theme) => callback(theme)),
  getStayInView: () => ipcRenderer.invoke('get-stay-in-view'),
  onStayInViewChanged: (callback) => ipcRenderer.on('stay-in-view-changed', (event, stayInView) => callback(stayInView)),
  loaderComplete: () => ipcRenderer.invoke('loader-complete')
});

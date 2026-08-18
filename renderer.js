const { ipcRenderer, clipboard } = require('electron');
const Modal = require('./components/modal');
const Editor = require('./components/editor');
const NoteCard = require('./components/noteCard');
const PasswordCard = require('./components/passwordCard');
const PasswordModal = require('./components/passwordModal');
const SettingsPanel = require('./components/settingsPanel');
const PasswordManager = require('./utils/passwordManager');
const ClipCard = require('./components/clipCard');
const ClipManager = require('./utils/clipManager');
const ReminderManager = require('./utils/reminder');
const keybindings = require('./utils/keybindingsStore');
const { extractTags } = require('./utils/noteTags');
const { newId } = require('./utils/id');
const { copySecret } = require('./utils/secureClipboard');
const { escapeHtml, sanitizeUrl } = require('./utils/sanitize');

// State
let notes = [];
let passwords = [];
let clips = [];
let currentNote = null;
let currentPassword = null;
let isCollapsed = true;
let isDocked = true;
let searchQuery = '';
let activeTagFilter = null;
let expandedSize = { width: 800, height: Math.floor(window.screen.availHeight * 0.8) };
let tabDragMoved = false;
let currentUpdateState = null;
let focusModeOn = false;

// Components
let modal = new Modal();
let passwordModal = new PasswordModal();
let passwordManager = new PasswordManager();
let clipManager = new ClipManager();
let editor = null;
let reminderManager = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const arrowTab = document.getElementById('arrow-tab');
const searchInput = document.getElementById('search-input');
const notesContainer = document.getElementById('notes-container');
const editorElement = document.getElementById('editor');
const newNoteBtn = document.getElementById('new-note-btn');
const noteTitleInput = document.getElementById('note-title');
const wordCountEl = document.getElementById('word-count');
const charCountEl = document.getElementById('char-count');

// Initialize
async function init() {
  // Ensure arrow tab is visible (fix for macOS logout/login issue)
  ensureArrowTabVisible();

  // Register IPC listeners before anything gets awaited below. Main sends
  // 'init-settings'/'dock-mode-changed'/'show-onboarding' as soon as the page
  // finishes loading, which can race ahead of an async init() that hasn't
  // reached this call yet — on a slow load, those sends would arrive before
  // any listener existed and be silently dropped (theme/edge/sidebar-width
  // never applied, undocked mode never expanding, onboarding never shown).
  setupIpcListeners();

  // Load the effective keybindings (defaults + any user overrides) before
  // the editor starts listening for keydown, since it matches against them.
  await keybindings.load();

  const btnFocusModeTitle = document.getElementById('btn-focus-mode');
  if (btnFocusModeTitle) {
    btnFocusModeTitle.title = `Focus Mode (${keybindings.formatBinding(keybindings.getBinding('toggleFocusMode'))})`;
  }

  // Initialize editor
  editor = new Editor(editorElement);
  editor.onChange = saveCurrentNote;

  // Load notes, passwords and clips
  await loadNotes();
  await loadPasswords();
  await loadClips();
  
  // Setup event listeners
  setupEventListeners();

  // Track mouse for click-through
  setupMouseTracking();
  
  // Initialize reminder manager with callback
  reminderManager = new ReminderManager(checkReminders);
  reminderManager.start();
  
  // Check notification permissions
  checkNotificationPermissions();
  
  // Open the most recently updated note by default
  if (notes.length === 0) {
    createNewNote();
  } else {
    // Sort notes by updated date (most recent first)
    const sortedNotes = [...notes].sort((a, b) => 
      new Date(b.updated) - new Date(a.updated)
    );
    openNote(sortedNotes[0]);
  }
}

async function checkNotificationPermissions() {
  const isSupported = await ipcRenderer.invoke('check-notification-permission');
  if (!isSupported) {
    console.warn('Notifications are not supported on this system');
  }
}

function setupEventListeners() {
  // Arrow tab toggle (suppressed if the click was actually the end of a drag)
  arrowTab.addEventListener('click', () => {
    if (tabDragMoved) return;
    toggleSidebar();
  });
  setupTabDragging();
  setupWidthDragging();
  setupSidebarSplitter();

  // Search
  searchInput.addEventListener('input', handleSearch);
  searchInput.addEventListener('keydown', (e) => {
    // Down arrow from the search box jumps into the notes list.
    if (e.key === 'ArrowDown') {
      const firstCard = notesContainer.querySelector('.note-card');
      if (firstCard) {
        e.preventDefault();
        firstCard.focus();
      }
    }
  });

  // Keyboard navigation for the notes list: ↑/↓ move between cards, Enter
  // opens the focused note. The cards themselves are focusable (tabIndex in
  // NoteCard.render), and the list re-renders often, so delegate at the
  // container instead of binding per-card.
  notesContainer.addEventListener('keydown', (e) => {
    const card = e.target.closest('.note-card');
    if (!card) return;

    const cards = Array.from(notesContainer.querySelectorAll('.note-card'));
    const index = cards.indexOf(card);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? cards[Math.min(index + 1, cards.length - 1)]
        : cards[Math.max(index - 1, 0)];
      if (next) next.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const note = notes.find(n => n.id === card.dataset.noteId);
      if (note) openNote(note);
    }
  });

  // New note button
  newNoteBtn.addEventListener('click', createNewNote);

  // New password button
  const newPasswordBtn = document.getElementById('new-password-btn');
  if (newPasswordBtn) {
    newPasswordBtn.addEventListener('click', async () => {
      const result = await passwordModal.show();
      if (result && result.action === 'create') {
        await passwordManager.createPassword(result.data);
        await loadPasswords();
        showMessage('Password created', 'success');
      }
    });
  }

  // New clip button (captures the current OS clipboard contents)
  const newClipBtn = document.getElementById('new-clip-btn');
  if (newClipBtn) {
    newClipBtn.addEventListener('click', async () => {
      const result = await clipManager.captureFromClipboard();
      if (result.success) {
        await loadClips();
        showMessage(result.duplicate ? 'Already saved' : 'Clip saved', 'success');
      } else {
        showMessage(result.error || 'Failed to save clip', 'error');
      }
    });
  }

  // Tab switching
  const tabs = document.querySelectorAll('.sidebar-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Setup all dropdowns (includes the consolidated Insert menu)
  setupAllDropdowns();

  // Floating formatting toolbar that appears near selected text
  setupFormatToolbar();
  setupNoteLinking();

  // Color picker
  document.getElementById('btn-color').addEventListener('click', showColorPicker);

  // Focus mode — dims the sidebar and editor chrome, leaving just the note
  const btnFocusMode = document.getElementById('btn-focus-mode');
  if (btnFocusMode) {
    btnFocusMode.addEventListener('click', toggleFocusMode);
  }

  // Reminder button
  document.getElementById('btn-reminder').addEventListener('click', () => {
    if (currentNote) {
      showReminderModal(currentNote);
    }
  });

  // Dock / undock toggle
  const dockToggleBtn = document.getElementById('btn-dock-toggle');
  if (dockToggleBtn) {
    dockToggleBtn.addEventListener('click', () => {
      ipcRenderer.send('toggle-dock-mode');
    });
  }

  // Custom window controls (only visible/relevant while undocked)
  const winClose = document.getElementById('win-close');
  if (winClose) {
    winClose.addEventListener('click', () => ipcRenderer.send('toggle-dock-mode'));
  }
  const winMinimize = document.getElementById('win-minimize');
  if (winMinimize) {
    winMinimize.addEventListener('click', () => ipcRenderer.send('window-minimize'));
  }
  const winMaximize = document.getElementById('win-maximize');
  if (winMaximize) {
    winMaximize.addEventListener('click', () => ipcRenderer.send('window-maximize-toggle'));
  }

  // Update status pill — clickable once a download is ready (restart to
  // install) or, on macOS, once a new version is merely available (opens it)
  const updatePill = document.getElementById('update-pill');
  if (updatePill) {
    updatePill.addEventListener('click', () => {
      if (!currentUpdateState) return;
      if (currentUpdateState.readyToInstall) {
        ipcRenderer.send('quit-and-install');
      } else if (currentUpdateState.releaseUrl) {
        ipcRenderer.send('open-external-link', currentUpdateState.releaseUrl);
      }
    });
  }

  // Title input — updates currentNote and triggers debounced save
  if (noteTitleInput) {
    noteTitleInput.addEventListener('input', () => {
      saveCurrentNote();
    });
    noteTitleInput.addEventListener('blur', flushPendingSave);
    // Enter in title moves focus to editor body
    noteTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editor.focus();
      }
    });
  }

  // Flush pending save when window loses focus or before unload
  window.addEventListener('blur', flushPendingSave);
  window.addEventListener('beforeunload', flushPendingSave);
  editorElement.addEventListener('blur', flushPendingSave);

  // Word/character count updates
  editorElement.addEventListener('input', updateWordCount);

  // Find-in-note bar wiring
  setupFindBar();

  // Drag and drop for images
  editorElement.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  
  editorElement.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        await editor.insertImage(file);
      }
    }
    saveCurrentNote();
  });

  // Press `h` to collapse the sidebar when not typing in an editable field.
  // Only applies while docked — an undocked window has no collapsed state.
  document.addEventListener('keydown', (e) => {
    if (!isDocked || !keybindings.matches('collapseSidebar', e)) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    if (!isCollapsed) {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Escape collapses the expanded window (unless a modal or the find bar
  // is on top of it, in which case its own Escape handler closes it instead)
  document.addEventListener('keydown', (e) => {
    if (!isDocked || e.key !== 'Escape' || isCollapsed) return;
    if (document.querySelector('.modal-overlay')) return;
    const findBar = document.getElementById('find-bar');
    if (findBar && !findBar.classList.contains('hidden')) return;
    toggleSidebar();
  });
}

function setupIpcListeners() {
  ipcRenderer.on('init-settings', (event, settings) => {
    applyTheme(settings.theme);
    applyEdge(settings.edge === 'left' ? 'left' : 'right');
    if (settings.expandedWidth && settings.expandedHeight) {
      expandedSize = { width: settings.expandedWidth, height: settings.expandedHeight };
    }
    if (settings.sidebarWidth) {
      sidebar.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);
    }
  });

  // Main process reports the user's manual resize so the next expand
  // remembers it instead of resetting to the default size.
  ipcRenderer.on('window-resized', (event, { width, height }) => {
    if (!isCollapsed) {
      expandedSize = { width, height };
    }
  });

  ipcRenderer.on('edge-changed', (event, edge) => {
    applyEdge(edge);
  });

  ipcRenderer.on('dock-mode-changed', (event, docked) => {
    applyDockMode(docked);
  });

  ipcRenderer.on('theme-changed', (event, theme) => {
    applyTheme(theme);
  });

  ipcRenderer.on('new-note', () => {
    createNewNote();
  });

  ipcRenderer.on('new-note-from-template', (event, templateId) => {
    createNewNoteFromTemplate(templateId);
  });

  ipcRenderer.on('reload-notes', async () => {
    await loadNotes();
    renderNotes();
  });

  ipcRenderer.on('reload-clips', async () => {
    await loadClips();
  });

  ipcRenderer.on('show-message', (event, { type, message }) => {
    showMessage(message, type);
  });
  
  ipcRenderer.on('collapse-sidebar', () => {
    if (!isCollapsed) {
      toggleSidebar();
    }
  });
  
  ipcRenderer.on('expand-sidebar', () => {
    if (isCollapsed) {
      toggleSidebar();
    }
  });
  
  ipcRenderer.on('open-note', async (event, noteId) => {
    // Refresh from disk first — the in-memory `notes` may be stale if a note
    // was added/edited since the renderer loaded, in which case `find` would
    // return undefined and leave the previously-opened note visible.
    await loadNotes();
    const note = notes.find(n => n.id === noteId);
    if (note) {
      if (isCollapsed) {
        toggleSidebar();
      }
      openNote(note);
    }
  });
  
  ipcRenderer.on('check-reminders', () => {
    // Don't reload notes - use current in-memory notes to avoid race conditions
    checkReminders();
  });
  
  ipcRenderer.on('show-update-notes', (event, updateInfo) => {
    showUpdateNotesModal(updateInfo);
  });

  ipcRenderer.on('update-status', (event, state) => {
    currentUpdateState = state;
    renderUpdateStatus(state);
  });

  ipcRenderer.on('open-settings', () => {
    showSettingsModal();
  });

  ipcRenderer.on('show-onboarding', () => {
    // The window starts as a tiny 30x80 collapsed tab — expand it first so
    // there's actually room to show the welcome modal.
    if (isCollapsed) {
      toggleSidebar();
    }
    setTimeout(showOnboardingModal, 350);
  });
}

function ensureArrowTabVisible() {
  // Explicitly ensure the arrow tab is visible and properly styled
  // This fixes an issue where the arrow tab disappears after macOS logout/login
  if (arrowTab) {
    arrowTab.style.display = 'flex';
    arrowTab.style.position = 'fixed';
    arrowTab.style.left = '0';
    arrowTab.style.zIndex = '1000';
    
    // Ensure the arrow icon is visible
    const arrowIcon = document.getElementById('arrow-icon');
    if (arrowIcon) {
      arrowIcon.style.display = 'block';
    }
  }
}

function setupMouseTracking() {
  document.addEventListener('mousemove', (e) => {
    if (isCollapsed) {
      // When collapsed, the window is only 30px wide, so any mouse movement is in the arrow tab
      ipcRenderer.send('set-ignore-mouse', false);
    } else {
      // When expanded, don't ignore mouse events
      ipcRenderer.send('set-ignore-mouse', false);
    }
  });
}

// Movement (in CSS px) past which a mousedown+mouseup on the tab counts as
// a drag rather than a click. Needs to be forgiving enough that ordinary
// trackpad/mouse jitter during a click doesn't get misread as a drag and
// swallow the click (which would make the tab seem to stop responding).
const DRAG_THRESHOLD = 8;

function setupTabDragging() {
  let dragOrigin = null;

  arrowTab.addEventListener('mousedown', (e) => {
    dragOrigin = { x: e.screenX, y: e.screenY };
    tabDragMoved = false;
    ipcRenderer.send('tab-drag-start');
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragOrigin) return;
    const dx = e.screenX - dragOrigin.x;
    const dy = e.screenY - dragOrigin.y;
    if (!tabDragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    tabDragMoved = true;
    ipcRenderer.send('tab-drag-move', { dx, dy });
    dragOrigin = { x: e.screenX, y: e.screenY };
  });

  document.addEventListener('mouseup', () => {
    if (!dragOrigin) return;
    if (tabDragMoved) {
      ipcRenderer.send('tab-drag-end');
    }
    dragOrigin = null;
  });

  // Defensive cleanup: if the window loses focus mid-drag (mouse released
  // outside the window, or the OS steals focus), we'd otherwise never get
  // the mouseup and could be left with stuck drag state.
  window.addEventListener('blur', () => {
    if (dragOrigin && tabDragMoved) {
      ipcRenderer.send('tab-drag-end');
    }
    dragOrigin = null;
  });
}

function setupWidthDragging() {
  const handle = document.getElementById('resize-handle');
  if (!handle) return;
  let dragStartX = null;

  handle.addEventListener('mousedown', (e) => {
    dragStartX = e.screenX;
    ipcRenderer.send('width-drag-start');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (dragStartX === null) return;
    ipcRenderer.send('width-drag-move', { dx: e.screenX - dragStartX });
  });

  document.addEventListener('mouseup', () => {
    if (dragStartX === null) return;
    dragStartX = null;
    ipcRenderer.send('width-drag-end');
  });

  window.addEventListener('blur', () => {
    if (dragStartX !== null) {
      ipcRenderer.send('width-drag-end');
    }
    dragStartX = null;
  });
}

// Drag handle between the notes list and the editor. Purely a renderer/CSS
// concern (unlike setupWidthDragging, which resizes the actual OS window) —
// it just adjusts the --sidebar-width custom property, so no IPC round trip
// is needed until the drag ends and the final width gets persisted.
function setupSidebarSplitter() {
  const splitter = document.getElementById('sidebar-splitter');
  if (!splitter) return;

  const MIN_SIDEBAR = 220;
  const MIN_EDITOR = 320;
  let dragging = false;

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    sidebar.classList.remove('resizing');
    document.body.style.cursor = '';
    const width = Math.round(sidebar.getBoundingClientRect().width);
    ipcRenderer.send('save-sidebar-width', width);
  };

  splitter.addEventListener('mousedown', (e) => {
    if (isCollapsed || document.getElementById('app').classList.contains('wide-mode')) return;
    dragging = true;
    splitter.classList.add('dragging');
    // The sidebar's collapse/expand width transition would otherwise fight
    // every mousemove update, making the drag laggy and the final width
    // (read on mouseup) reflect a mid-transition value instead of the mouse's
    // actual position.
    sidebar.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const appRect = document.getElementById('app').getBoundingClientRect();
    const maxWidth = Math.max(MIN_SIDEBAR, appRect.width - MIN_EDITOR);
    const newWidth = Math.min(maxWidth, Math.max(MIN_SIDEBAR, e.clientX - appRect.left));
    sidebar.style.setProperty('--sidebar-width', `${newWidth}px`);
  });

  document.addEventListener('mouseup', stopDragging);
  window.addEventListener('blur', stopDragging);
}

function applyEdge(edge) {
  arrowTab.classList.toggle('left-edge', edge === 'left');
  document.body.classList.toggle('left-edge', edge === 'left');
}

function applyDockMode(docked) {
  isDocked = docked;
  document.body.classList.toggle('undocked', !docked);

  const dockBtn = document.getElementById('btn-dock-toggle');
  if (dockBtn) {
    dockBtn.title = docked ? 'Undock into a normal window' : 'Dock back to the screen edge';
  }

  if (!docked) {
    // Windowed mode always shows the full UI — there's no collapsed state.
    // Main process already sized the window; just sync the visual classes.
    isCollapsed = false;
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('expanded');
    arrowTab.classList.add('expanded');
    document.body.classList.add('expanded');
  }
}

// Dims the sidebar and editor chrome (toolbar, footer) so only the note
// title and body stay at full visibility — dimmed elements still work, just
// faded until hovered, so switching notes/formatting is still one hover away.
function toggleFocusMode() {
  focusModeOn = !focusModeOn;
  document.body.classList.toggle('focus-mode', focusModeOn);
}

function toggleSidebar() {
  isCollapsed = !isCollapsed;

  // Tell main process about the collapsed state first so it can adjust
  // resizable/minimum-size constraints before the bounds are changed below
  // (otherwise a stale minimum size can clamp the collapse to 30x80).
  ipcRenderer.send('set-collapsed', isCollapsed);

  if (isCollapsed) {
    sidebar.classList.remove('expanded');
    sidebar.classList.add('collapsed');
    arrowTab.classList.remove('expanded');
    document.body.classList.remove('expanded');
    // Collapsed: 30px width, 80px height (arrow tab size)
    ipcRenderer.send('resize-window', { width: 30, height: 80 });
  } else {
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('expanded');
    arrowTab.classList.add('expanded');
    document.body.classList.add('expanded');
    ipcRenderer.send('resize-window', { width: expandedSize.width, height: expandedSize.height });
  }
}

async function loadNotes() {
  notes = await ipcRenderer.invoke('get-notes');
  if (migrateNotesToTitleField(notes)) {
    await ipcRenderer.invoke('save-notes', notes);
  }
  renderNotes();
}

// One-shot migration: pre-existing notes have title baked into content as an
// auto-generated H1 (or just the first line). Lift that into a real `title`
// field and remove it from content so the editor body and the title input are
// fully decoupled. Returns true if anything was migrated (so caller persists).
function migrateNotesToTitleField(allNotes) {
  let changed = false;
  for (const note of allNotes) {
    if (typeof note.title === 'string') continue;
    const { title, content } = extractTitleFromContent(note.content || '');
    note.title = title;
    note.content = content;
    changed = true;
  }
  return changed;
}

function extractTitleFromContent(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';

  // Skip leading whitespace-only text nodes
  let first = tmp.firstChild;
  while (first && first.nodeType === Node.TEXT_NODE && !first.textContent.trim()) {
    first = first.nextSibling;
  }

  if (first && first.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(first.tagName)) {
    const title = (first.textContent || '').trim();
    first.remove();
    return { title, content: tmp.innerHTML };
  }

  if (first && first.nodeType === Node.TEXT_NODE) {
    const text = first.textContent;
    const newlineIdx = text.indexOf('\n');
    if (newlineIdx === -1) {
      const title = text.trim();
      first.remove();
      return { title, content: tmp.innerHTML };
    }
    const title = text.slice(0, newlineIdx).trim();
    first.textContent = text.slice(newlineIdx + 1);
    return { title, content: tmp.innerHTML };
  }

  // No clear title source — preserve content, leave title empty
  return { title: '', content: html || '' };
}

async function loadPasswords() {
  passwords = await passwordManager.loadPasswords();
  renderPasswords();
}

function renderPasswords() {
  const passwordsContainer = document.getElementById('passwords-container');
  const passwordsCount = document.getElementById('passwords-count');
  
  if (!passwordsContainer || !passwordsCount) return;
  
  passwordsContainer.innerHTML = '';
  passwordsCount.textContent = passwords.length;
  
  if (passwords.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = 'var(--spacing-md)';
    empty.innerHTML = `
      <div class="empty-state-icon" style="font-size: 32px;">🔐</div>
      <div class="empty-state-text">No passwords yet</div>
    `;
    passwordsContainer.appendChild(empty);
    return;
  }
  
  passwords.forEach(password => {
    const passwordCard = new PasswordCard(password, {
      onClick: openPassword,
      onDelete: deletePassword,
      onToggleFavorite: togglePasswordFavorite,
      onCopyPassword: copyPasswordSecurely,
      isActive: currentPassword && currentPassword.id === password.id
    });
    passwordsContainer.appendChild(passwordCard.render());
  });
}

async function openPassword(password) {
  currentPassword = password;
  renderPasswords();
  
  const result = await passwordModal.show(password);
  if (result) {
    if (result.action === 'delete') {
      await deletePassword(password);
    } else if (result.action === 'update') {
      await passwordManager.updatePassword(result.data);
      await loadPasswords();
    }
  }
  
  currentPassword = null;
  renderPasswords();
}

async function deletePassword(password) {
  if (confirm('Delete this password? This action cannot be undone.')) {
    await passwordManager.deletePassword(password.id);
    await loadPasswords();
    showMessage('Password deleted', 'success');
  }
}

async function togglePasswordFavorite(password) {
  password.isFavorite = !password.isFavorite;
  await passwordManager.updatePassword(password);
  await loadPasswords();
}

// Copies a password entry's secret to the OS clipboard and schedules an
// automatic clipboard clear (see utils/secureClipboard). Wired to the
// PasswordCard 📋 button — which previously had no callback and silently
// did nothing.
async function copyPasswordSecurely(password) {
  try {
    const result = await passwordManager.getDecryptedPassword(password.id);
    if (result.success && result.data.password) {
      await copySecret(result.data.password);
      showMessage('Password copied — clipboard clears in 30s', 'success');
    } else {
      showMessage('Failed to decrypt password', 'error');
    }
  } catch (error) {
    console.error('Failed to copy password:', error);
    showMessage('Failed to copy password', 'error');
  }
}

async function loadClips() {
  clips = await clipManager.loadClips();
  renderClips();
}

function renderClips() {
  const clipsContainer = document.getElementById('clips-container');
  const clipsCount = document.getElementById('clips-count');

  if (!clipsContainer || !clipsCount) return;

  clipsContainer.innerHTML = '';
  clipsCount.textContent = clips.length;

  if (clips.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = 'var(--spacing-md)';
    empty.innerHTML = `
      <div class="empty-state-icon" style="font-size: 32px;">📋</div>
      <div class="empty-state-text">No clips yet</div>
    `;
    clipsContainer.appendChild(empty);
    return;
  }

  clips.forEach(clip => {
    const clipCard = new ClipCard(clip, {
      onCopy: copyClip,
      onDelete: deleteClip
    });
    clipsContainer.appendChild(clipCard.render());
  });
}

function copyClip(clip) {
  clipboard.writeText(clip.text);
  showMessage('Copied to clipboard', 'success');
}

async function deleteClip(clip) {
  await clipManager.deleteClip(clip.id);
  await loadClips();
}

async function saveNotes() {
  await ipcRenderer.invoke('save-notes', notes);
  maybeAutoExport();
}

// Fire-and-forget: if the user has turned on auto-export in Settings, mirror
// every save out to their chosen folder too. Failures are silent here (no
// export folder configured is the common case, not an error worth a toast).
async function maybeAutoExport() {
  const sync = await ipcRenderer.invoke('get-sync-settings');
  if (sync.autoExport && sync.folderPath) {
    require('./utils/markdownExport').exportNotes(notes).catch(() => {});
  }
}

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.dataset.content === tabName) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // Passwords/Clips have no use for the note editor column, so let the
  // sidebar take the full window instead of leaving it empty.
  document.getElementById('app').classList.toggle('wide-mode', tabName !== 'notes');
}

function renderTagFilters() {
  const container = document.getElementById('tag-filters');
  if (!container) return;

  const allTags = new Set();
  notes.forEach(note => extractTags(note.content).forEach(tag => allTags.add(tag)));

  if (allTags.size === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');

  container.innerHTML = '';
  [...allTags].sort().forEach(tag => {
    const pill = document.createElement('button');
    pill.className = 'tag-filter-pill';
    if (activeTagFilter === tag) pill.classList.add('active');
    pill.textContent = `#${tag}`;
    pill.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === tag ? null : tag;
      renderNotes();
    });
    container.appendChild(pill);
  });
}

function renderNotes() {
  notesContainer.innerHTML = '';

  // Update notes count
  const notesCount = document.getElementById('notes-count');
  if (notesCount) {
    notesCount.textContent = notes.length;
  }

  renderTagFilters();

  let filteredNotes = notes;
  if (searchQuery) {
    filteredNotes = filteredNotes.filter(note => {
      const content = note.content.replace(/<[^>]*>/g, '').toLowerCase();
      return content.includes(searchQuery.toLowerCase());
    });
  }
  if (activeTagFilter) {
    filteredNotes = filteredNotes.filter(note => extractTags(note.content).includes(activeTagFilter));
  }

  // Sort notes: pinned first, then favorites, then by manual drag order.
  // Array.sort is stable, so notes within the same tier keep their
  // existing relative order.
  filteredNotes.sort((a, b) => noteRank(a) - noteRank(b));
  
  if (filteredNotes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">📝</div>
      <div class="empty-state-text">${(searchQuery || activeTagFilter) ? 'No notes found' : 'No notes yet'}</div>
    `;
    notesContainer.appendChild(empty);
    return;
  }
  
  filteredNotes.forEach(note => {
    const noteCard = new NoteCard(note, {
      onClick: openNote,
      onDelete: deleteNote,
      onSetReminder: showReminderModal,
      onReorder: reorderNotes,
      onToggleFavorite: toggleNoteFavorite,
      onTogglePin: toggleNotePin,
      isActive: currentNote && currentNote.id === note.id
    });
    notesContainer.appendChild(noteCard.render());
  });
}

function toggleNoteFavorite(note) {
  note.isFavorite = !note.isFavorite;
  saveNotes();
  renderNotes();
}

function toggleNotePin(note) {
  note.isPinned = !note.isPinned;
  saveNotes();
  renderNotes();
}

// Lower rank = higher priority = sorts earlier. Pinned notes always sit
// above favorites, which sit above everything else.
function noteRank(note) {
  if (note.isPinned) return 0;
  if (note.isFavorite) return 1;
  return 2;
}

function reorderNotes(draggedNoteId, targetNoteId, insertBefore) {
  // Find the indices of the dragged and target notes
  const draggedIndex = notes.findIndex(n => n.id === draggedNoteId);
  const targetIndex = notes.findIndex(n => n.id === targetNoteId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  const draggedNote = notes[draggedIndex];
  const targetNote = notes[targetIndex];

  // Keep pinned/favorite/normal as contiguous tiers — a note can be
  // reordered freely within its own tier, but can't cross into another
  // (e.g. a pinned note can't be dropped below a non-pinned one).
  const draggedRank = noteRank(draggedNote);
  const targetRank = noteRank(targetNote);
  if (draggedRank < targetRank && !insertBefore) return;
  if (draggedRank > targetRank && insertBefore) return;

  // Remove the dragged note from its current position
  notes.splice(draggedIndex, 1);
  
  // Calculate the new index
  let newIndex = notes.findIndex(n => n.id === targetNoteId);
  
  // Insert at the appropriate position
  if (insertBefore) {
    notes.splice(newIndex, 0, draggedNote);
  } else {
    notes.splice(newIndex + 1, 0, draggedNote);
  }
  
  // Save and re-render
  saveNotes();
  renderNotes();
}

function createNewNote() {
  const note = {
    id: newId(),
    title: '',
    content: '',
    backgroundColor: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    reminders: []
  };

  notes.unshift(note);
  saveNotes();
  openNote(note);
  renderNotes();

  if (isCollapsed) {
    toggleSidebar();
  }

  // Focus title input so user can immediately name the note
  if (noteTitleInput) {
    noteTitleInput.focus();
  }
}

function createNewNoteFromTemplate(templateId) {
  const { getTemplate } = require('./utils/noteTemplates');
  const template = getTemplate(templateId);
  if (!template) return;

  const note = {
    id: newId(),
    title: template.title(),
    content: template.content(),
    backgroundColor: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    reminders: []
  };

  notes.unshift(note);
  saveNotes();
  openNote(note);
  renderNotes();

  if (isCollapsed) {
    toggleSidebar();
  }
}

function openNote(note) {
  // Flush any pending save for the previous note before switching
  flushPendingSave();

  currentNote = note;
  if (noteTitleInput) {
    noteTitleInput.value = note.title || '';
  }
  editor.setContent(note.content);
  updateWordCount();
  renderNotes();
  
  // Apply background color to editor
  if (note.backgroundColor) {
    editorElement.style.backgroundColor = note.backgroundColor;
    
    // Calculate brightness from rgba color
    const rgb = rgbaToRgb(note.backgroundColor);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    
    // Use dark text for light backgrounds, light text for dark backgrounds
    const textColor = brightness > 180 ? '#1a1a1a' : '#e0e0e0';
    const linkColor = brightness > 180 ? '#0066cc' : '#66b3ff';
    
    editorElement.style.color = textColor;
    
    // Update link colors
    editorElement.querySelectorAll('a').forEach(link => {
      link.style.color = linkColor;
    });
    
    // Add style for future links
    let styleId = 'editor-link-style';
    let existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #editor a {
        color: ${linkColor} !important;
      }
      #editor a:hover {
        color: ${brightness > 180 ? '#0052a3' : '#88ccff'} !important;
      }
    `;
    document.head.appendChild(style);
  } else {
    editorElement.style.backgroundColor = '';
    editorElement.style.color = '';

    // Remove custom link style
    let styleId = 'editor-link-style';
    let existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }
  }

  renderBacklinksIndicator(note);
}

// Finds every OTHER note whose content contains a [[wiki-link]] pointing at
// this one (see insertNoteLink — a note-link is an <a class="note-link"
// data-note-link="targetId">). This is a pure forward scan done on demand,
// not a maintained index, since notes.json is small enough that rescanning
// on note-open is cheap.
function getBacklinks(noteId) {
  const results = [];
  notes.forEach(note => {
    if (note.id === noteId) return;
    if (!note.content || note.content.indexOf('data-note-link') === -1) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = note.content;
    const linksHere = Array.from(tmp.querySelectorAll('a.note-link[data-note-link]'))
      .some(a => a.getAttribute('data-note-link') === noteId);
    if (linksHere) results.push(note);
  });
  return results;
}

function renderBacklinksIndicator(note) {
  const el = document.getElementById('backlinks-indicator');
  if (!el) return;

  const backlinks = getBacklinks(note.id);
  if (backlinks.length === 0) {
    el.classList.add('hidden');
    el.textContent = '';
    el.onclick = null;
    return;
  }

  el.classList.remove('hidden');
  el.textContent = `🔗 Linked from ${backlinks.length}`;
  el.onclick = () => showBacklinksModal(backlinks);
}

function showBacklinksModal(backlinks) {
  const content = document.createElement('div');
  content.className = 'backlinks-panel';

  backlinks.forEach(note => {
    const row = document.createElement('div');
    row.className = 'backlink-row';
    row.textContent = note.title || 'Untitled';
    row.addEventListener('click', () => {
      modal.close();
      if (isCollapsed) toggleSidebar();
      openNote(note);
    });
    content.appendChild(row);
  });

  modal.create('Linked From', content);
}

// Debounce disk writes — every keystroke used to write the whole notes.json.
// Keep in-memory currentNote updated immediately so reads stay consistent;
// only the persist + sidebar re-render are debounced.
let saveTimeoutId = null;
const SAVE_DEBOUNCE_MS = 400;

function saveCurrentNote() {
  if (!currentNote) return;

  currentNote.content = editor.getContent();
  if (noteTitleInput) {
    currentNote.title = noteTitleInput.value;
  }
  currentNote.updated = new Date().toISOString();

  clearTimeout(saveTimeoutId);
  saveTimeoutId = setTimeout(() => {
    saveTimeoutId = null;
    saveNotes();
    renderNotes();
  }, SAVE_DEBOUNCE_MS);
}

function flushPendingSave() {
  if (saveTimeoutId === null) return;
  clearTimeout(saveTimeoutId);
  saveTimeoutId = null;
  saveNotes();
  renderNotes();
}

function updateWordCount() {
  if (!wordCountEl || !charCountEl) return;
  const text = editor ? editor.getTextContent() : '';
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  wordCountEl.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  charCountEl.textContent = `${chars} ${chars === 1 ? 'character' : 'characters'}`;
}

function setupFindBar() {
  const bar = document.getElementById('find-bar');
  const input = document.getElementById('find-input');
  const counter = document.getElementById('find-counter');
  const prev = document.getElementById('find-prev');
  const next = document.getElementById('find-next');
  const close = document.getElementById('find-close');
  if (!bar || !input) return;

  const openBar = () => {
    bar.classList.remove('hidden');
    input.focus();
    input.select();
    if (input.value) runFind();
  };

  const closeBar = () => {
    editor.clearFindHighlights();
    bar.classList.add('hidden');
    counter.textContent = '0 / 0';
    editor.focus();
  };

  const runFind = () => {
    const total = editor.findInNote(input.value);
    counter.textContent = total > 0 ? `1 / ${total}` : '0 / 0';
  };

  const updateCounter = () => {
    const matches = editorElement.querySelectorAll('.find-match');
    const total = matches.length;
    const current = total > 0 ? (editor.activeMatchIndex + 1) : 0;
    counter.textContent = `${current} / ${total}`;
  };

  input.addEventListener('input', runFind);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) editor.prevMatch();
      else editor.nextMatch();
      updateCounter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeBar();
    }
  });

  prev.addEventListener('click', () => { editor.prevMatch(); updateCounter(); });
  next.addEventListener('click', () => { editor.nextMatch(); updateCounter(); });
  close.addEventListener('click', closeBar);

  // App-level shortcuts (find, shortcuts panel, new note) — all remappable in Settings.
  document.addEventListener('keydown', (e) => {
    if (keybindings.matches('findInNote', e)) {
      if (isCollapsed) return; // editor not visible
      e.preventDefault();
      openBar();
    }
    if (keybindings.matches('showShortcuts', e)) {
      e.preventDefault();
      showShortcutsModal();
    }
    if (keybindings.matches('newNote', e)) {
      if (document.querySelector('.modal-overlay')) return;
      e.preventDefault();
      createNewNote();
    }
    if (keybindings.matches('toggleFocusMode', e)) {
      e.preventDefault();
      toggleFocusMode();
    }
  });
}

function showShortcutsModal() {
  const groups = keybindings.getAllForUI();

  // These aren't single-combo actions (multi-key sequences, contextual
  // behavior) so they're not part of the remappable keybindings registry —
  // shown here as fixed reference text.
  const staticSections = {
    Navigation: [
      [':n (in search)', 'Create a new note'],
      [':t (in search)', 'Create a new note from a template'],
      ['tag:x (in search)', 'Show only notes tagged #x'],
      ['title:x (in search)', 'Search note titles only'],
      ['Esc', 'Close search / find / modal, or collapse the sidebar']
    ],
    Editing: [
      ['Tab / Shift Tab', 'Indent / outdent list item'],
      ['Enter (empty list/task)', 'Exit the list'],
      ['Backspace (start of task)', 'Remove the checkbox']
    ],
    'Markdown shortcuts (type then space)': [
      ['# … ######', 'Heading 1 – 6'],
      ['- / * / +', 'Bullet list'],
      ['1.', 'Numbered list'],
      ['[ ] / [x]', 'Task item'],
      ['>', 'Blockquote'],
      ['---', 'Horizontal rule'],
      ['**text**', 'Bold'],
      ['*text*', 'Italic'],
      ['~~text~~', 'Strikethrough'],
      ['==text==', 'Highlight'],
      ['`text`', 'Inline code']
    ]
  };

  const order = ['Global', 'Navigation', 'Formatting', 'Blocks', 'Editing', 'Markdown shortcuts (type then space)'];

  const content = document.createElement('div');
  content.className = 'shortcuts-panel';

  order.forEach((title) => {
    const rows = [
      ...(groups[title] || []).map((item) => [item.display, item.label]),
      ...(staticSections[title] || [])
    ];
    if (rows.length === 0) return;

    const section = document.createElement('div');
    section.className = 'shortcuts-section';

    const h = document.createElement('h3');
    h.className = 'shortcuts-section-title';
    h.textContent = title;
    section.appendChild(h);

    const table = document.createElement('div');
    table.className = 'shortcuts-table';
    rows.forEach(([keys, desc]) => {
      const row = document.createElement('div');
      row.className = 'shortcuts-row';
      const kbd = document.createElement('span');
      kbd.className = 'shortcuts-keys';
      kbd.textContent = keys;
      const label = document.createElement('span');
      label.className = 'shortcuts-desc';
      label.textContent = desc;
      row.appendChild(kbd);
      row.appendChild(label);
      table.appendChild(row);
    });
    section.appendChild(table);
    content.appendChild(section);
  });

  const hint = document.createElement('div');
  hint.className = 'shortcuts-hint';
  hint.textContent = 'Customize any of these in Settings → Keyboard Shortcuts.';
  content.appendChild(hint);

  modal.create('Keyboard Shortcuts', content);
}

function showOnboardingModal() {
  const searchKeys = keybindings.formatBinding(keybindings.getBinding('globalSearch'));
  const clipKeys = keybindings.formatBinding(keybindings.getBinding('globalClip'));
  const shortcutsKeys = keybindings.formatBinding(keybindings.getBinding('showShortcuts'));

  const content = document.createElement('div');
  content.className = 'onboarding-panel';
  content.innerHTML = `
    <p class="settings-description">
      NoteMinder lives docked to your screen edge and stays out of the way until you need it.
    </p>
    <ul class="onboarding-list">
      <li><span class="keybind-pill">${searchKeys}</span> opens search from any app — jump to a note, link, password, or clip.</li>
      <li><span class="keybind-pill">${clipKeys}</span> saves whatever's on your clipboard as a searchable clip, from any app.</li>
      <li><span class="keybind-pill">${shortcutsKeys}</span> shows the full shortcuts list any time.</li>
      <li>The <strong>⚙️ Settings</strong> icon above lets you remap any shortcut, or back up notes to a folder.</li>
      <li>Click the arrow tab (or press Escape) to collapse NoteMinder back to the edge.</li>
    </ul>
  `;

  const gotItBtn = document.createElement('button');
  gotItBtn.className = 'btn btn-primary';
  gotItBtn.style.width = '100%';
  gotItBtn.style.marginTop = '16px';
  gotItBtn.textContent = 'Got it';
  gotItBtn.onclick = () => modal.close();
  content.appendChild(gotItBtn);

  modal.create('Welcome to NoteMinder', content);
  modal.onClose = () => ipcRenderer.send('onboarding-complete');
}

async function showTrashModal() {
  const content = document.createElement('div');
  content.className = 'trash-panel';

  const DAY_MS = 24 * 60 * 60 * 1000;

  const renderList = async () => {
    const items = await ipcRenderer.invoke('get-trash');
    content.innerHTML = '';

    if (items.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🗑️</div>
          <div class="empty-state-text">Trash is empty</div>
        </div>
      `;
      return;
    }

    const desc = document.createElement('p');
    desc.className = 'settings-description';
    desc.textContent = 'Deleted notes are kept for 7 days before being permanently removed.';
    content.appendChild(desc);

    items.forEach(note => {
      const daysLeft = Math.max(0, 7 - Math.floor((Date.now() - new Date(note.deletedAt).getTime()) / DAY_MS));

      const row = document.createElement('div');
      row.className = 'trash-row';
      row.innerHTML = `
        <div class="trash-row-info">
          <div class="trash-row-title">${note.title || 'Untitled'}</div>
          <div class="trash-row-meta">Deleted ${new Date(note.deletedAt).toLocaleDateString()} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left</div>
        </div>
        <div class="trash-row-actions">
          <button class="btn btn-small trash-restore">Restore</button>
          <button class="btn btn-small trash-delete">Delete Forever</button>
        </div>
      `;

      row.querySelector('.trash-restore').addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('restore-note', note.id);
        if (result.success) {
          await loadNotes();
          renderNotes();
          showMessage('Note restored', 'success');
          renderList();
        }
      });

      row.querySelector('.trash-delete').addEventListener('click', async () => {
        if (!confirm("Permanently delete this note? This can't be undone.")) return;
        await ipcRenderer.invoke('permanently-delete-note', note.id);
        renderList();
      });

      content.appendChild(row);
    });

    const emptyAllBtn = document.createElement('button');
    emptyAllBtn.className = 'btn btn-small';
    emptyAllBtn.style.marginTop = '12px';
    emptyAllBtn.textContent = 'Empty Trash';
    emptyAllBtn.addEventListener('click', async () => {
      if (!confirm("Permanently delete everything in trash? This can't be undone.")) return;
      await ipcRenderer.invoke('empty-trash');
      renderList();
    });
    content.appendChild(emptyAllBtn);
  };

  await renderList();
  modal.create('Trash', content);
}

function showSettingsModal() {
  const settingsPanel = new SettingsPanel({
    notes: () => notes,
    showMessage
  });
  const content = settingsPanel.renderPanel();
  modal.create('Settings', content);
  modal.onClose = () => settingsPanel.destroy();
}

function deleteNote(note) {
  if (confirm('Delete this note?')) {
    notes = notes.filter(n => n.id !== note.id);
    saveNotes();
    // Moved to trash, not gone — recoverable from Settings > More > Trash
    // for 7 days before it's purged for good.
    ipcRenderer.invoke('trash-note', note);

    if (currentNote && currentNote.id === note.id) {
      if (notes.length > 0) {
        openNote(notes[0]);
      } else {
        currentNote = null;
        editor.clear();
        if (noteTitleInput) noteTitleInput.value = '';
        updateWordCount();
      }
    }

    renderNotes();
  }
}

function handleSearch(e) {
  searchQuery = e.target.value;
  renderNotes();
}

// Typing [[ in the editor opens a note-picker; selecting one (or pressing
// Enter/Tab) inserts a non-editable, clickable token that jumps straight
// to that note. Links are stored by note id (data-note-link), so they
// keep working even if the target note's title changes later.
function setupNoteLinking() {
  const popup = document.getElementById('link-autocomplete');
  if (!popup) return;

  let linkQuery = null;
  let suggestions = [];
  let selectedIndex = 0;

  function getQueryAtCursor() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return null;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const textBefore = node.textContent.slice(0, range.startOffset);
    const match = textBefore.match(/\[\[([^\[\]]*)$/);
    if (!match) return null;
    return { query: match[1], node, matchStart: range.startOffset - match[0].length, matchEnd: range.startOffset };
  }

  function closePopup() {
    popup.classList.add('hidden');
    popup.innerHTML = '';
    linkQuery = null;
  }

  function updatePopupPosition() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    popup.style.top = `${rect.bottom + 6}px`;
    popup.style.left = `${rect.left}px`;
  }

  function renderSuggestions() {
    popup.innerHTML = '';
    if (suggestions.length === 0) {
      const item = document.createElement('div');
      item.className = 'link-suggestion-item link-suggestion-empty';
      item.textContent = 'No matching notes';
      popup.appendChild(item);
      return;
    }
    suggestions.forEach((entry, i) => {
      const item = document.createElement('div');
      item.className = 'link-suggestion-item';
      if (entry.__createNew) item.classList.add('link-suggestion-create');
      if (i === selectedIndex) item.classList.add('selected');
      item.textContent = entry.__createNew ? `Create note "${entry.title}"` : (entry.title || 'Untitled');
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectSuggestion(entry);
      });
      popup.appendChild(item);
    });
  }

  function insertNoteLink(note, q) {
    const { node, matchStart, matchEnd } = q;
    const text = node.textContent;
    const before = text.slice(0, matchStart);
    const after = text.slice(matchEnd);

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'note-link';
    link.setAttribute('data-note-link', note.id);
    link.setAttribute('contenteditable', 'false');
    link.textContent = note.title || 'Untitled';

    const beforeTextNode = document.createTextNode(before);
    const afterTextNode = document.createTextNode(after || ' ');

    const parent = node.parentNode;
    parent.insertBefore(beforeTextNode, node);
    parent.insertBefore(link, node);
    parent.insertBefore(afterTextNode, node);
    parent.removeChild(node);

    const range = document.createRange();
    range.setStart(afterTextNode, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    saveCurrentNote();
  }

  function selectSuggestion(entry) {
    if (!linkQuery) return;
    if (entry.__createNew) {
      const newNote = {
        id: newId(),
        title: entry.title,
        content: '',
        backgroundColor: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        reminders: []
      };
      notes.unshift(newNote);
      saveNotes();
      insertNoteLink(newNote, linkQuery);
      renderNotes();
    } else {
      insertNoteLink(entry, linkQuery);
    }
    closePopup();
  }

  editorElement.addEventListener('input', () => {
    const q = getQueryAtCursor();
    if (!q) {
      closePopup();
      return;
    }
    linkQuery = q;

    const lowerQuery = q.query.toLowerCase();
    suggestions = notes
      .filter(n => !currentNote || n.id !== currentNote.id)
      .filter(n => (n.title || 'Untitled').toLowerCase().includes(lowerQuery))
      .slice(0, 5);

    const exactMatch = notes.some(n => (n.title || '').toLowerCase() === lowerQuery);
    if (q.query.trim() && !exactMatch) {
      suggestions.push({ __createNew: true, title: q.query.trim() });
    }

    selectedIndex = 0;
    updatePopupPosition();
    popup.classList.remove('hidden');
    renderSuggestions();
  });

  editorElement.addEventListener('keydown', (e) => {
    if (popup.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, Math.max(suggestions.length - 1, 0));
      renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderSuggestions();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions.length > 0) {
        e.preventDefault();
        selectSuggestion(suggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
    }
  });

  // Don't leave the popup stuck open if focus moves away without closing
  // it explicitly (clicking elsewhere in the sidebar, switching notes, etc.)
  editorElement.addEventListener('blur', closePopup);

  // Clicking an inserted note-link jumps straight to that note
  editorElement.addEventListener('click', (e) => {
    const link = e.target.closest('a.note-link');
    if (!link) return;
    e.preventDefault();
    const target = notes.find(n => n.id === link.getAttribute('data-note-link'));
    if (target) {
      openNote(target);
    } else {
      showMessage('That note no longer exists', 'error');
    }
  });
}

function setupFormatToolbar() {
  const toolbar = document.getElementById('format-toolbar');
  if (!toolbar) return;

  function updatePosition() {
    if (isCollapsed) {
      toolbar.classList.add('hidden');
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toolbar.classList.add('hidden');
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editorElement.contains(range.commonAncestorContainer)) {
      toolbar.classList.add('hidden');
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      toolbar.classList.add('hidden');
      return;
    }

    toolbar.classList.remove('hidden');
    const toolbarRect = toolbar.getBoundingClientRect();
    let top = rect.top - toolbarRect.height - 8;
    if (top < 4) {
      top = rect.bottom + 8; // not enough room above; show below instead
    }
    let left = rect.left + rect.width / 2 - toolbarRect.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - toolbarRect.width - 4));

    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
  }

  document.addEventListener('selectionchange', updatePosition);
  editorElement.addEventListener('blur', () => toolbar.classList.add('hidden'));

  // Use mousedown (not click) with preventDefault so the text selection
  // survives the click on the button — same technique the dropdown menus use.
  toolbar.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!editor) return;

    if (btn.dataset.cmd) {
      editor.execCommand(btn.dataset.cmd);
    } else if (btn.dataset.heading) {
      editor.insertHeading(parseInt(btn.dataset.heading, 10));
    } else if (btn.dataset.action === 'code') {
      editor.insertCode();
    } else if (btn.dataset.action === 'link') {
      editor.insertLink();
    }
  });
}

function setupAllDropdowns() {
  // Store the selection when dropdown button is clicked
  let savedSelection = null;
  
  const dropdowns = [
    {
      buttonId: 'insert-menu-dropdown',
      items: {
        'Bullet List': () => {
          if (editor) editor.insertList('bullet');
        },
        'Numbered List': () => {
          if (editor) editor.insertList('numbered');
        },
        'Task List': () => {
          if (editor) editor.insertTaskList();
        },
        'Blockquote': () => {
          if (editor) editor.insertBlockquote();
        },
        'Code Block': () => {
          if (editor) editor.insertCodeBlock();
        },
        'Table': () => {
          if (editor) editor.insertTable();
        },
        'Image': () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
              await editor.insertImage(file);
              saveCurrentNote();
            }
          };
          input.click();
        },
        'Password Field': () => {
          if (currentNote) showPasswordModal();
        },
        'Import Markdown': () => {
          importMarkdown();
        },
        'Clear Formatting': () => {
          if (editor) editor.clearBlockFormat();
        }
      }
    },
    {
      buttonId: 'more-menu-dropdown',
      items: {
        'Search': () => {
          ipcRenderer.send('open-search-window');
        },
        'Keyboard Shortcuts': () => {
          showShortcutsModal();
        },
        'Trash': () => {
          showTrashModal();
        },
        'Settings': () => {
          showSettingsModal();
        }
      }
    }
  ];

  // Setup each dropdown
  dropdowns.forEach(({ buttonId, items }) => {
    const button = document.getElementById(buttonId);
    if (!button) {
      console.error('Button not found:', buttonId);
      return;
    }
    
    const dropdown = button.nextElementSibling;
    if (!dropdown) {
      console.error('Dropdown not found for button:', buttonId);
      return;
    }
    
    // Clear any existing items
    dropdown.innerHTML = '';
    
    // Populate dropdown items
    Object.entries(items).forEach(([label, action]) => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = label;
      
      // Use mousedown instead of click to preserve selection
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent losing focus
        e.stopPropagation();

        // Restore the saved selection before executing action
        if (savedSelection) {
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(savedSelection);
        }
        
        // Execute the action
        action();
        
        // Close dropdown
        dropdown.classList.add('hidden');
        
        // Clear saved selection
        savedSelection = null;
      });
      
      dropdown.appendChild(item);
    });
    
    // Button click handler
    button.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing focus
      e.stopPropagation();

      // Save current selection
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
      }
      
      // Close all other dropdowns
      document.querySelectorAll('.dropdown-menu').forEach(d => {
        if (d !== dropdown) {
          d.classList.add('hidden');
        }
      });
      
      // Toggle this dropdown
      dropdown.classList.toggle('hidden');
    });
  });
  
  // Single document-level click handler to close all dropdowns
  document.addEventListener('click', (e) => {
    // Check if click is outside all dropdowns
    const clickedInsideDropdown = e.target.closest('.dropdown');
    if (!clickedInsideDropdown) {
      document.querySelectorAll('.dropdown-menu').forEach(d => {
        d.classList.add('hidden');
      });
      savedSelection = null;
    }
  });
}

function showColorPicker() {
  const colors = [
    'rgba(255, 182, 193, 1)',  // Light Pink - brighter
    'rgba(255, 218, 185, 1)',  // Peach - brighter
    'rgba(255, 253, 208, 1)',  // Cream - brighter
    'rgba(221, 255, 221, 1)',  // Mint - brighter
    'rgba(173, 216, 230, 1)',  // Light Blue - brighter
    'rgba(221, 160, 221, 1)',  // Plum - brighter
    'rgba(255, 228, 196, 1)',  // Bisque - brighter
    'rgba(176, 224, 230, 1)',  // Powder Blue - brighter
    'rgba(255, 192, 203, 1)',  // Pink - brighter
    'rgba(230, 230, 250, 1)',  // Lavender - brighter
    'rgba(240, 255, 240, 1)',  // Honeydew - brighter
    'rgba(255, 240, 245, 1)'   // Lavender Blush - brighter
  ];
  
  const content = document.createElement('div');
  content.className = 'color-picker-container';
  
  colors.forEach(color => {
    const option = document.createElement('div');
    option.className = 'color-option';
    option.style.backgroundColor = color;
    if (currentNote && currentNote.backgroundColor === color) {
      option.classList.add('active');
    }
    option.addEventListener('click', () => {
      if (currentNote) {
        currentNote.backgroundColor = color;
        saveCurrentNote();
        openNote(currentNote);
        modal.close();
      }
    });
    content.appendChild(option);
  });
  
  // Add clear option
  const clearOption = document.createElement('div');
  clearOption.className = 'color-option';
  clearOption.style.backgroundColor = 'transparent';
  clearOption.style.border = '2px dashed var(--border-color)';
  clearOption.textContent = '✕';
  clearOption.style.display = 'flex';
  clearOption.style.alignItems = 'center';
  clearOption.style.justifyContent = 'center';
  clearOption.addEventListener('click', () => {
    if (currentNote) {
      currentNote.backgroundColor = null;
      saveCurrentNote();
      openNote(currentNote);
      modal.close();
    }
  });
  content.appendChild(clearOption);
  
  modal.create('Choose Background Color', content);
}

function showPasswordModal() {
  const PasswordField = require('./components/passwordField');
  
  const content = document.createElement('div');
  content.style.maxWidth = '500px';
  
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">Label *</label>
      <input type="text" id="pwd-label" class="input" placeholder="e.g., Gmail Account" required>
    </div>
    
    <div class="form-group">
      <label class="form-label">Username/Email</label>
      <input type="text" id="pwd-username" class="input" placeholder="username@example.com">
    </div>
    
    <div class="form-group">
      <label class="form-label">Password *</label>
      <div style="display: flex; gap: 8px;">
        <input type="password" id="pwd-password" class="input" placeholder="Enter password" required style="flex: 1;">
        <button type="button" id="toggle-pwd-visibility" class="btn" style="padding: 8px 12px;">👁️</button>
        <button type="button" id="generate-pwd" class="btn" style="padding: 8px 12px;">🎲</button>
      </div>
      <div id="password-strength" style="margin-top: 8px; font-size: 12px;"></div>
    </div>
    
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea id="pwd-description" class="input" placeholder="Optional notes about this password" rows="2"></textarea>
    </div>
    
    <div style="display: flex; gap: 10px;">
      <button type="submit" class="btn btn-primary" style="flex: 1;">Add Password Field</button>
      <button type="button" id="cancel-pwd" class="btn" style="padding: 8px 16px;">Cancel</button>
    </div>
  `;
  
  const passwordInput = form.querySelector('#pwd-password');
  const toggleBtn = form.querySelector('#toggle-pwd-visibility');
  const generateBtn = form.querySelector('#generate-pwd');
  const strengthDiv = form.querySelector('#password-strength');
  const cancelBtn = form.querySelector('#cancel-pwd');
  
  // Toggle password visibility
  toggleBtn.addEventListener('click', () => {
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      toggleBtn.textContent = '👁️‍🗨️';
    } else {
      passwordInput.type = 'password';
      toggleBtn.textContent = '👁️';
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
      updatePasswordStrength(result.password);
    }
  });
  
  // Password strength indicator
  function updatePasswordStrength(password) {
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
  
  passwordInput.addEventListener('input', (e) => {
    updatePasswordStrength(e.target.value);
  });
  
  cancelBtn.addEventListener('click', () => {
    modal.close();
  });
  
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const passwordData = {
      label: form.querySelector('#pwd-label').value,
      username: form.querySelector('#pwd-username').value,
      password: form.querySelector('#pwd-password').value,
      description: form.querySelector('#pwd-description').value
    };
    
    try {
      const passwordField = new PasswordField(passwordData);
      const passwordElement = passwordField.render();
      
      // Insert into editor
      const selection = window.getSelection();
      const range = selection.getRangeCount > 0 ? selection.getRangeAt(0) : null;
      
      if (range) {
        range.deleteContents();
        range.insertNode(passwordElement);
        
        // Move cursor after the password field
        const newRange = document.createRange();
        newRange.setStartAfter(passwordElement);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      } else {
        editorElement.appendChild(passwordElement);
      }
      
      // Save the note
      saveCurrentNote();
      
      modal.close();
      showMessage('Password field added (will be encrypted on save)', 'success');
    } catch (error) {
      console.error('Error adding password field:', error);
      showMessage('Failed to add password field', 'error');
    }
  };
  
  content.appendChild(form);
  modal.create('Add Password Field', content);
  
  // Focus the label input
  setTimeout(() => {
    form.querySelector('#pwd-label').focus();
  }, 100);
}

function showReminderModal(note) {
  const content = document.createElement('div');
  
  // Show current date/time at the top
  const currentDateTime = document.createElement('div');
  currentDateTime.style.padding = '10px';
  currentDateTime.style.backgroundColor = 'var(--bg-secondary)';
  currentDateTime.style.borderRadius = '4px';
  currentDateTime.style.marginBottom = '20px';
  currentDateTime.style.fontSize = '14px';
  currentDateTime.style.color = 'var(--text-secondary)';
  
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    second: '2-digit'
  });
  
  currentDateTime.innerHTML = `
    <div style="font-weight: 500; margin-bottom: 4px;">Current Date & Time</div>
    <div>${dateStr}</div>
    <div>${timeStr}</div>
  `;
  content.appendChild(currentDateTime);
  
  // Show existing reminders if any
  if (note.reminders && note.reminders.length > 0) {
    const activeReminders = note.reminders.filter(r => r.enabled);
    const pastReminders = note.reminders.filter(r => !r.enabled);
    
    // Active Reminders Section
    if (activeReminders.length > 0) {
      const existingReminders = document.createElement('div');
      existingReminders.style.marginBottom = '20px';
      
      const title = document.createElement('h3');
      title.textContent = 'Active Reminders';
      title.style.fontSize = '14px';
      title.style.marginBottom = '10px';
      title.style.color = 'var(--text-primary)';
      existingReminders.appendChild(title);
      
      activeReminders.forEach((reminder) => {
        const index = note.reminders.indexOf(reminder);
        const reminderItem = document.createElement('div');
        reminderItem.style.padding = '10px';
        reminderItem.style.backgroundColor = 'var(--bg-secondary)';
        reminderItem.style.borderRadius = '4px';
        reminderItem.style.marginBottom = '8px';
        reminderItem.style.display = 'flex';
        reminderItem.style.justifyContent = 'space-between';
        reminderItem.style.alignItems = 'center';
        
        const reminderInfo = document.createElement('div');
        reminderInfo.style.flex = '1';
        
        const nextTime = reminderManager.getNextReminderTime(reminder);
        const displayText = reminderManager.formatReminderDisplay(reminder);
        
        let typeText = '';
        if (reminder.type === 'once') {
          typeText = 'One-time';
        } else if (reminder.type === 'daily') {
          typeText = 'Daily';
        } else if (reminder.type === 'weekly') {
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          typeText = `Weekly (${days[reminder.dayOfWeek]})`;
        }
        
        reminderInfo.innerHTML = `
          <div style="font-weight: 500; margin-bottom: 4px;">${displayText}</div>
          <div style="font-size: 12px; color: var(--text-secondary);">${typeText} at ${reminder.time}</div>
          ${reminder.message ? `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">"${reminder.message}"</div>` : ''}
        `;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '✕';
        deleteBtn.className = 'btn';
        deleteBtn.style.padding = '4px 8px';
        deleteBtn.style.fontSize = '14px';
        deleteBtn.style.marginLeft = '10px';
        deleteBtn.onclick = (e) => {
          e.preventDefault();
          note.reminders.splice(index, 1);
          saveNotes();
          renderNotes();
          showMessage('Reminder deleted', 'success');
          // Refresh the modal to show updated reminders
          showReminderModal(note);
        };
        
        reminderItem.appendChild(reminderInfo);
        reminderItem.appendChild(deleteBtn);
        existingReminders.appendChild(reminderItem);
      });
      
      content.appendChild(existingReminders);
    }
    
    // Past Reminders Section
    if (pastReminders.length > 0) {
      const pastRemindersSection = document.createElement('div');
      pastRemindersSection.style.marginBottom = '20px';
      
      const title = document.createElement('h3');
      title.textContent = 'Past Reminders';
      title.style.fontSize = '14px';
      title.style.marginBottom = '10px';
      title.style.color = 'var(--text-secondary)';
      pastRemindersSection.appendChild(title);
      
      pastReminders.forEach((reminder) => {
        const index = note.reminders.indexOf(reminder);
        const reminderItem = document.createElement('div');
        reminderItem.style.padding = '10px';
        reminderItem.style.backgroundColor = 'var(--bg-tertiary)';
        reminderItem.style.borderRadius = '4px';
        reminderItem.style.marginBottom = '8px';
        reminderItem.style.display = 'flex';
        reminderItem.style.justifyContent = 'space-between';
        reminderItem.style.alignItems = 'center';
        reminderItem.style.opacity = '0.7';
        
        const reminderInfo = document.createElement('div');
        reminderInfo.style.flex = '1';
        
        let typeText = '';
        let timeText = '';
        if (reminder.type === 'once') {
          typeText = 'One-time';
          timeText = `${reminder.date} at ${reminder.time}`;
        } else if (reminder.type === 'daily') {
          typeText = 'Daily';
          timeText = `at ${reminder.time}`;
        } else if (reminder.type === 'weekly') {
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          typeText = `Weekly (${days[reminder.dayOfWeek]})`;
          timeText = `at ${reminder.time}`;
        }
        
        reminderInfo.innerHTML = `
          <div style="font-weight: 500; margin-bottom: 4px; text-decoration: line-through;">${timeText}</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">${typeText} - Triggered</div>
          ${reminder.message ? `<div style="font-size: 12px; color: var(--text-tertiary); margin-top: 2px;">"${reminder.message}"</div>` : ''}
        `;
        
        const buttonGroup = document.createElement('div');
        buttonGroup.style.display = 'flex';
        buttonGroup.style.gap = '8px';
        buttonGroup.style.marginLeft = '10px';
        
        const reEnableBtn = document.createElement('button');
        reEnableBtn.textContent = '↻';
        reEnableBtn.className = 'btn';
        reEnableBtn.style.padding = '4px 8px';
        reEnableBtn.style.fontSize = '14px';
        reEnableBtn.title = 'Re-enable reminder';
        reEnableBtn.onclick = (e) => {
          e.preventDefault();
          reminder.enabled = true;
          reminder.lastTriggered = null;
          saveNotes();
          renderNotes();
          modal.close();
          showMessage('Reminder re-enabled', 'success');
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '✕';
        deleteBtn.className = 'btn';
        deleteBtn.style.padding = '4px 8px';
        deleteBtn.style.fontSize = '14px';
        deleteBtn.title = 'Delete reminder';
        deleteBtn.onclick = (e) => {
          e.preventDefault();
          note.reminders.splice(index, 1);
          saveNotes();
          renderNotes();
          showMessage('Reminder deleted', 'success');
          // Refresh the modal to show updated reminders
          showReminderModal(note);
        };
        
        buttonGroup.appendChild(reEnableBtn);
        buttonGroup.appendChild(deleteBtn);
        
        reminderItem.appendChild(reminderInfo);
        reminderItem.appendChild(buttonGroup);
        pastRemindersSection.appendChild(reminderItem);
      });
      
      content.appendChild(pastRemindersSection);
    }
    
    const separator = document.createElement('hr');
    separator.style.border = 'none';
    separator.style.borderTop = '1px solid var(--border-color)';
    separator.style.margin = '20px 0';
    content.appendChild(separator);
  }
  
  const formTitle = document.createElement('h3');
  formTitle.textContent = 'Add New Reminder';
  formTitle.style.fontSize = '14px';
  formTitle.style.marginBottom = '15px';
  formTitle.style.color = 'var(--text-primary)';
  content.appendChild(formTitle);
  
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">Reminder Type</label>
      <select id="reminder-type" class="input">
        <option value="once">One-time</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
    </div>
    
    <div class="form-group" id="date-group">
      <label class="form-label">Date</label>
      <input type="date" id="reminder-date" class="input" required>
    </div>
    
    <div class="form-group" id="day-group" style="display: none;">
      <label class="form-label">Day of Week</label>
      <select id="reminder-day" class="input">
        <option value="0">Sunday</option>
        <option value="1">Monday</option>
        <option value="2">Tuesday</option>
        <option value="3">Wednesday</option>
        <option value="4">Thursday</option>
        <option value="5">Friday</option>
        <option value="6">Saturday</option>
      </select>
    </div>
    
    <div class="form-group">
      <label class="form-label">Time</label>
      <input type="time" id="reminder-time" class="input" required>
    </div>
    
    <div class="form-group">
      <label class="form-label">Message (optional)</label>
      <input type="text" id="reminder-message" class="input" placeholder="Reminder message">
    </div>
    
    <button type="submit" class="btn btn-primary" style="width: 100%;">Set Reminder</button>
  `;
  
  const typeSelect = form.querySelector('#reminder-type');
  const dateGroup = form.querySelector('#date-group');
  const dayGroup = form.querySelector('#day-group');
  
  // Set default date to today
  const today = new Date();
  const dateInput = form.querySelector('#reminder-date');
  dateInput.value = today.toISOString().split('T')[0];
  dateInput.min = today.toISOString().split('T')[0];
  
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'weekly') {
      dateGroup.style.display = 'none';
      dayGroup.style.display = 'block';
    } else if (typeSelect.value === 'once') {
      dateGroup.style.display = 'block';
      dayGroup.style.display = 'none';
    } else {
      dateGroup.style.display = 'none';
      dayGroup.style.display = 'none';
    }
  });
  
  form.onsubmit = (e) => {
    e.preventDefault();
    
    const reminder = {
      type: form.querySelector('#reminder-type').value,
      time: form.querySelector('#reminder-time').value,
      message: form.querySelector('#reminder-message').value,
      enabled: true
    };
    
    if (reminder.type === 'once') {
      reminder.date = form.querySelector('#reminder-date').value;
    } else if (reminder.type === 'weekly') {
      reminder.dayOfWeek = parseInt(form.querySelector('#reminder-day').value);
    }
    
    if (!note.reminders) {
      note.reminders = [];
    }

    note.reminders.push(reminder);
    saveNotes();
    renderNotes();
    modal.close();

    const displayText = reminderManager.formatReminderDisplay(reminder);
    showMessage(`Reminder set for ${displayText}`, 'success');
  };
  
  content.appendChild(form);
  modal.create('Reminders', content);
}

async function importMarkdown() {
  const result = await ipcRenderer.invoke('import-markdown');
  if (!result.success) return;

  const html = markdownToHtml(result.content);

  // If imported content starts with an H1 and the current note has no title,
  // lift the H1 into the title field and import only the body.
  if (currentNote && !((currentNote.title || '').trim())) {
    const { title, content } = extractTitleFromContent(html);
    if (title) {
      noteTitleInput.value = title;
      editor.execCommand('insertHTML', content);
      saveCurrentNote();
      return;
    }
  }

  editor.execCommand('insertHTML', html);
  saveCurrentNote();
}

function markdownToHtml(markdown) {
  // SECURITY: escape the raw input first. The previous version interpolated
  // the file straight into innerHTML, so an imported .md containing markup
  // (<img onerror>, <script>) executed with full Node access (this window
  // runs with nodeIntegration). Escaping first means only the tags generated
  // by the transforms below can ever appear in the output.
  let html = escapeHtml(markdown);

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Code
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');

  // Links — validate the scheme so [x](javascript:…) can't smuggle script
  // in through the href. The label is already escaped text from above.
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, label, url) => {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return label;
    return `<a href="${safeUrl}">${label}</a>`;
  });

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function showReminderBanner(message, noteId, reminder) {
  const banner = document.getElementById('reminder-banner');
  const messageEl = banner.querySelector('.reminder-banner-message');
  const closeBtn = banner.querySelector('.reminder-banner-close');

  messageEl.textContent = message;
  banner.classList.remove('hidden');

  const hide = () => banner.classList.add('hidden');

  // Auto-hide after 10 seconds
  const autoHideTimeout = setTimeout(hide, 10000);

  // Close button handler
  const closeHandler = () => {
    clearTimeout(autoHideTimeout);
    hide();
    closeBtn.removeEventListener('click', closeHandler);
  };

  closeBtn.addEventListener('click', closeHandler);

  // Snooze buttons — push the reminder out by N minutes. This re-fires the
  // banner + notification when the snooze elapses (see ReminderManager.isDue).
  banner.querySelectorAll('.reminder-snooze-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const minutes = Number(btn.dataset.snoozeMinutes) || 10;
      snoozeReminder(noteId, reminder, minutes);
      clearTimeout(autoHideTimeout);
      hide();
    }, { once: true });
  });

  // Click banner to open note
  const bannerClickHandler = (e) => {
    if (e.target.closest('.reminder-banner-close, .reminder-snooze-btn')) return;
    const note = notes.find(n => n.id === noteId);
    if (note) {
      if (isCollapsed) {
        toggleSidebar();
      }
      openNote(note);
      hide();
      clearTimeout(autoHideTimeout);
    }
  };

  banner.addEventListener('click', bannerClickHandler, { once: true });
}

// Moves the reminder's next firing to now + `minutes` by setting a
// snoozeUntil timestamp. The reminder keeps its original schedule — snooze
// is a one-shot override evaluated first by ReminderManager.isDue.
function snoozeReminder(noteId, reminder, minutes) {
  if (!reminder) return;
  const note = notes.find(n => n.id === noteId);
  if (!note) return;

  reminder.snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  saveNotes();
  renderNotes();
  showMessage(`Snoozed for ${minutes} minute${minutes === 1 ? '' : 's'}`, 'success');
}

function checkReminders() {
  let dueReminders = 0;

  notes.forEach((note) => {
    if (!note.reminders || note.reminders.length === 0) {
      return;
    }

    note.reminders.forEach((reminder) => {
      if (!reminder.enabled) {
        return;
      }

      if (reminderManager.isDue(reminder)) {
        dueReminders++;
        const message = reminder.message || 'Reminder for your note';

        // Show in-app banner (with snooze actions)
        showReminderBanner(message, note.id, reminder);

        // Also send system notification
        ipcRenderer.send('show-notification', {
          title: 'NoteMinder Reminder',
          body: message,
          noteId: note.id
        });

        // Update last triggered; a consumed snooze is cleared so the
        // underlying schedule takes over again.
        reminder.lastTriggered = new Date().toISOString();
        delete reminder.snoozeUntil;

        // Disable one-time reminders once fired (including via snooze).
        if (reminder.type === 'once') {
          reminder.enabled = false;
        }
      }
    });
  });

  if (dueReminders > 0) {
    saveNotes();
    renderNotes();
  }
}

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  document.body.classList.toggle('paper-theme', theme === 'paper');
}

function renderUpdateStatus(state) {
  const pill = document.getElementById('update-pill');
  if (!pill) return;

  if (!state) {
    pill.classList.add('hidden');
    pill.textContent = '';
    return;
  }

  pill.classList.remove('hidden');
  pill.classList.toggle('update-pill-ready', !!state.readyToInstall);
  pill.classList.toggle('update-pill-downloading', state.status === 'downloading');

  if (state.status === 'downloading') {
    pill.textContent = `⬇️ ${state.percent || 0}%`;
    pill.title = `Downloading NoteMinder v${state.version}…`;
  } else if (state.readyToInstall) {
    pill.textContent = '🔄 Restart to update';
    pill.title = `NoteMinder v${state.version} is ready to install`;
  } else {
    pill.textContent = `⬆️ v${state.version} available`;
    pill.title = 'Click to view the release';
  }
}

function showUpdateNotesModal(updateInfo) {
  const content = document.createElement('div');
  content.style.maxHeight = '400px';
  content.style.overflowY = 'auto';
  
  // Version info
  const versionInfo = document.createElement('div');
  versionInfo.style.padding = '15px';
  versionInfo.style.backgroundColor = 'var(--bg-secondary)';
  versionInfo.style.borderRadius = '4px';
  versionInfo.style.marginBottom = '20px';
  versionInfo.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <div>
        <div style="font-size: 12px; color: var(--text-secondary);">Current Version</div>
        <div style="font-size: 18px; font-weight: 500;">${updateInfo.currentVersion || 'Unknown'}</div>
      </div>
      <div style="font-size: 24px; color: var(--text-secondary);">→</div>
      <div>
        <div style="font-size: 12px; color: var(--text-secondary);">New Version</div>
        <div style="font-size: 18px; font-weight: 500; color: var(--accent-color);">${updateInfo.latestVersion || 'Unknown'}</div>
      </div>
    </div>
    <div style="font-size: 12px; color: var(--text-secondary);">
      Released: ${updateInfo.releaseDate ? new Date(updateInfo.releaseDate).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }) : 'Unknown'}
    </div>
  `;
  content.appendChild(versionInfo);
  
  // Release notes
  if (updateInfo.releaseNotes) {
    const notesTitle = document.createElement('h3');
    notesTitle.textContent = 'Release Notes';
    notesTitle.style.fontSize = '14px';
    notesTitle.style.marginBottom = '10px';
    notesTitle.style.color = 'var(--text-primary)';
    content.appendChild(notesTitle);
    
    const notesContent = document.createElement('div');
    notesContent.style.padding = '15px';
    notesContent.style.backgroundColor = 'var(--bg-secondary)';
    notesContent.style.borderRadius = '4px';
    notesContent.style.marginBottom = '20px';
    notesContent.style.whiteSpace = 'pre-wrap';
    notesContent.style.fontSize = '13px';
    notesContent.style.lineHeight = '1.6';
    notesContent.textContent = updateInfo.releaseNotes;
    content.appendChild(notesContent);
  }
  
  // View on GitHub button (always show this)
  if (updateInfo.releaseUrl) {
    const githubBtn = document.createElement('button');
    githubBtn.className = 'btn btn-primary';
    githubBtn.style.width = '100%';
    githubBtn.style.marginTop = '10px';
    githubBtn.textContent = 'Download from GitHub';
    githubBtn.onclick = () => {
      ipcRenderer.send('open-external-link', updateInfo.releaseUrl);
      modal.close();
    };
    content.appendChild(githubBtn);
  }
  
  modal.create(`Update Available - v${updateInfo.latestVersion}`, content);
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function showMessage(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `badge badge-${type}`;
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '10000';
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbaToRgb(rgba) {
  // Extract RGB values from rgba string
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return {
      r: parseInt(match[1]),
      g: parseInt(match[2]),
      b: parseInt(match[3])
    };
  }
  // Fallback to hexToRgb if it's a hex color
  return hexToRgb(rgba);
}

// Initialize app
document.addEventListener('DOMContentLoaded', init);

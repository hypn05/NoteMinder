const { ipcRenderer } = require('electron');
const Modal = require('./components/modal');
const Editor = require('./components/editor');
const NoteCard = require('./components/noteCard');
const ReminderManager = require('./utils/reminder');

// State
let notes = [];
let currentNote = null;
let isCollapsed = true;
let searchQuery = '';

// Components
let modal = new Modal();
let editor = null;
let reminderManager = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const arrowTab = document.getElementById('arrow-tab');
const searchInput = document.getElementById('search-input');
const notesContainer = document.getElementById('notes-container');
const editorElement = document.getElementById('editor');
const newNoteBtn = document.getElementById('new-note-btn');

// Initialize
async function init() {
  // Initialize editor
  editor = new Editor(editorElement);
  editor.onChange = saveCurrentNote;
  
  // Load notes
  await loadNotes();
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup IPC listeners
  setupIpcListeners();
  
  // Track mouse for click-through
  setupMouseTracking();
  
  // Initialize reminder manager with callback
  reminderManager = new ReminderManager(checkReminders);
  reminderManager.start();
  console.log('[Init] ReminderManager initialized and started');
  
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
  // Arrow tab toggle
  arrowTab.addEventListener('click', toggleSidebar);
  
  // Search
  searchInput.addEventListener('input', handleSearch);
  
  // New note button
  newNoteBtn.addEventListener('click', createNewNote);
  
  // Toolbar buttons
  document.getElementById('btn-bold').addEventListener('click', () => {
    if (editor) editor.execCommand('bold');
  });
  document.getElementById('btn-italic').addEventListener('click', () => {
    if (editor) editor.execCommand('italic');
  });
  document.getElementById('btn-underline').addEventListener('click', () => {
    if (editor) editor.execCommand('underline');
  });
  
  // Setup all dropdowns
  setupAllDropdowns();
  
  // Image upload
  document.getElementById('btn-image').addEventListener('click', () => {
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
  });
  
  // Color picker
  document.getElementById('btn-color').addEventListener('click', showColorPicker);
  
  // Reminder button
  document.getElementById('btn-reminder').addEventListener('click', () => {
    if (currentNote) {
      showReminderModal(currentNote);
    }
  });
  
  // Import markdown
  document.getElementById('btn-import-md').addEventListener('click', importMarkdown);
  
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
}

function setupIpcListeners() {
  ipcRenderer.on('init-settings', (event, settings) => {
    applyTheme(settings.theme);
  });
  
  ipcRenderer.on('theme-changed', (event, theme) => {
    applyTheme(theme);
  });
  
  ipcRenderer.on('new-note', () => {
    createNewNote();
  });
  
  ipcRenderer.on('reload-notes', async () => {
    await loadNotes();
    renderNotes();
  });
  
  ipcRenderer.on('show-message', (event, { type, message }) => {
    showMessage(message, type);
  });
  
  ipcRenderer.on('collapse-sidebar', () => {
    if (!isCollapsed) {
      toggleSidebar();
    }
  });
  
  ipcRenderer.on('open-note', (event, noteId) => {
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

function toggleSidebar() {
  isCollapsed = !isCollapsed;
  
  if (isCollapsed) {
    sidebar.classList.remove('expanded');
    sidebar.classList.add('collapsed');
    arrowTab.classList.remove('expanded');
    ipcRenderer.send('resize-window', 30);
  } else {
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('expanded');
    arrowTab.classList.add('expanded');
    // Calculate window width: 30px arrow + 30% of screen for sidebar + 70% for editor
    // For simplicity, use a fixed expanded width
    ipcRenderer.send('resize-window', 800);
  }
  
  ipcRenderer.send('set-collapsed', isCollapsed);
}

async function loadNotes() {
  notes = await ipcRenderer.invoke('get-notes');
  renderNotes();
}

async function saveNotes() {
  await ipcRenderer.invoke('save-notes', notes);
}

function renderNotes() {
  notesContainer.innerHTML = '';
  
  let filteredNotes = notes;
  if (searchQuery) {
    filteredNotes = notes.filter(note => {
      const content = note.content.replace(/<[^>]*>/g, '').toLowerCase();
      return content.includes(searchQuery.toLowerCase());
    });
  }
  
  if (filteredNotes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">📝</div>
      <div class="empty-state-text">${searchQuery ? 'No notes found' : 'No notes yet'}</div>
    `;
    notesContainer.appendChild(empty);
    return;
  }
  
  filteredNotes.forEach(note => {
    const noteCard = new NoteCard(note, {
      onClick: openNote,
      onDelete: deleteNote,
      onSetReminder: showReminderModal,
      isActive: currentNote && currentNote.id === note.id
    });
    notesContainer.appendChild(noteCard.render());
  });
}

function createNewNote() {
  const note = {
    id: Date.now().toString(),
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
}

function openNote(note) {
  currentNote = note;
  editor.setContent(note.content);
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
}

function saveCurrentNote() {
  if (!currentNote) return;
  
  currentNote.content = editor.getContent();
  currentNote.updated = new Date().toISOString();
  
  saveNotes();
  renderNotes();
}

function deleteNote(note) {
  if (confirm('Delete this note?')) {
    notes = notes.filter(n => n.id !== note.id);
    saveNotes();
    
    if (currentNote && currentNote.id === note.id) {
      if (notes.length > 0) {
        openNote(notes[0]);
      } else {
        currentNote = null;
        editor.clear();
      }
    }
    
    renderNotes();
  }
}

function handleSearch(e) {
  searchQuery = e.target.value;
  renderNotes();
}

function setupAllDropdowns() {
  // Store the selection when dropdown button is clicked
  let savedSelection = null;
  
  const dropdowns = [
    {
      buttonId: 'heading-dropdown',
      items: {
        'H1': () => {
          if (editor) editor.insertHeading(1);
        },
        'H2': () => {
          if (editor) editor.insertHeading(2);
        },
        'H3': () => {
          if (editor) editor.insertHeading(3);
        }
      }
    },
    {
      buttonId: 'insert-dropdown',
      items: {
        'Code': () => {
          if (editor) editor.insertCode();
        },
        'Code Block': () => {
          if (editor) editor.insertCodeBlock();
        },
        'Blockquote': () => {
          if (editor) editor.insertBlockquote();
        },
        'Link': () => {
          if (editor) editor.insertLink();
        }
      }
    },
    {
      buttonId: 'list-dropdown',
      items: {
        'Bullet List': () => {
          if (editor) editor.insertList('bullet');
        },
        'Numbered List': () => {
          if (editor) editor.insertList('numbered');
        },
        'Task List': () => {
          if (editor) editor.insertTaskList();
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
        console.log('Dropdown item clicked:', label);
        
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
      console.log('Dropdown button clicked:', buttonId);
      
      // Save current selection
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
        console.log('Selection saved:', savedSelection.toString());
      }
      
      // Close all other dropdowns
      document.querySelectorAll('.dropdown-menu').forEach(d => {
        if (d !== dropdown) {
          d.classList.add('hidden');
        }
      });
      
      // Toggle this dropdown
      dropdown.classList.toggle('hidden');
      console.log('Dropdown hidden state:', dropdown.classList.contains('hidden'));
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
    
    console.log('\n=== CREATING NEW REMINDER ===');
    console.log('Current time:', new Date().toISOString());
    console.log('Current time local:', new Date().toLocaleString());
    console.log('Note ID:', note.id);
    console.log('Reminder details:');
    console.log('  Type:', reminder.type);
    console.log('  Time:', reminder.time);
    console.log('  Date:', reminder.date || 'N/A');
    console.log('  Day of Week:', reminder.dayOfWeek !== undefined ? reminder.dayOfWeek : 'N/A');
    console.log('  Message:', reminder.message || '(none)');
    console.log('  Enabled:', reminder.enabled);
    
    if (!note.reminders) {
      note.reminders = [];
      console.log('Initialized empty reminders array for note');
    }
    
    note.reminders.push(reminder);
    console.log('Reminder added to note. Total reminders for this note:', note.reminders.length);
    
    saveNotes();
    console.log('Notes saved to storage');
    
    renderNotes();
    console.log('UI updated');
    
    modal.close();
    
    // Show confirmation with exact time
    console.log('About to call getNextReminderTime with reminder:', reminder);
    console.log('reminderManager exists?', !!reminderManager);
    console.log('reminderManager type:', typeof reminderManager);
    
    const nextTime = reminderManager.getNextReminderTime(reminder);
    console.log('getNextReminderTime returned:', nextTime);
    
    const displayText = reminderManager.formatReminderDisplay(reminder);
    console.log('formatReminderDisplay returned:', displayText);
    
    console.log('Next trigger time calculated:', nextTime ? nextTime.toISOString() : 'null');
    console.log('Next trigger time local:', nextTime ? nextTime.toLocaleString() : 'null');
    console.log('Display text:', displayText);
    console.log('=== REMINDER CREATED SUCCESSFULLY ===\n');
    
    showMessage(`Reminder set for ${displayText}`, 'success');
  };
  
  content.appendChild(form);
  modal.create('Reminders', content);
}

async function importMarkdown() {
  const result = await ipcRenderer.invoke('import-markdown');
  if (result.success) {
    const html = markdownToHtml(result.content);
    editor.execCommand('insertHTML', html);
    saveCurrentNote();
  }
}

function markdownToHtml(markdown) {
  let html = markdown;
  
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
  
  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

function showReminderBanner(message, noteId) {
  const banner = document.getElementById('reminder-banner');
  const messageEl = banner.querySelector('.reminder-banner-message');
  const closeBtn = banner.querySelector('.reminder-banner-close');
  
  messageEl.textContent = message;
  banner.classList.remove('hidden');
  
  // Auto-hide after 10 seconds
  const autoHideTimeout = setTimeout(() => {
    banner.classList.add('hidden');
  }, 10000);
  
  // Close button handler
  const closeHandler = () => {
    clearTimeout(autoHideTimeout);
    banner.classList.add('hidden');
    closeBtn.removeEventListener('click', closeHandler);
  };
  
  closeBtn.addEventListener('click', closeHandler);
  
  // Click banner to open note
  const bannerClickHandler = (e) => {
    if (e.target !== closeBtn && !closeBtn.contains(e.target)) {
      const note = notes.find(n => n.id === noteId);
      if (note) {
        if (isCollapsed) {
          toggleSidebar();
        }
        openNote(note);
        banner.classList.add('hidden');
        clearTimeout(autoHideTimeout);
      }
    }
  };
  
  banner.addEventListener('click', bannerClickHandler, { once: true });
}

function checkReminders() {
  console.log('=== CHECKING REMINDERS (renderer.js) ===');
  console.log('Current time:', new Date().toISOString());
  console.log('Current time local:', new Date().toLocaleString());
  console.log('Total notes:', notes.length);
  
  let totalReminders = 0;
  let enabledReminders = 0;
  let dueReminders = 0;
  
  notes.forEach((note, noteIndex) => {
    console.log(`\nNote ${noteIndex + 1} (ID: ${note.id}):`);
    
    if (!note.reminders || note.reminders.length === 0) {
      console.log('  No reminders');
      return;
    }
    
    console.log(`  Has ${note.reminders.length} reminder(s)`);
    
    note.reminders.forEach((reminder, index) => {
      totalReminders++;
      console.log(`\n  Reminder ${index + 1}:`);
      console.log('    Type:', reminder.type);
      console.log('    Time:', reminder.time);
      console.log('    Enabled:', reminder.enabled);
      console.log('    Date:', reminder.date || 'N/A');
      console.log('    Day of Week:', reminder.dayOfWeek !== undefined ? reminder.dayOfWeek : 'N/A');
      console.log('    Message:', reminder.message || 'N/A');
      console.log('    Last Triggered:', reminder.lastTriggered || 'Never');
      
      if (!reminder.enabled) {
        console.log('    ⊗ SKIPPED - Reminder is disabled');
        return;
      }
      
      enabledReminders++;
      
      const isDue = reminderManager.isDue(reminder);
      console.log('    Is due:', isDue);
      
      if (isDue) {
        dueReminders++;
        console.log('    ✓ REMINDER IS DUE - Showing banner and sending notification');
        
        const message = reminder.message || 'Reminder for your note';
        
        // Show in-app banner
        showReminderBanner(message, note.id);
        
        // Also send system notification
        ipcRenderer.send('show-notification', {
          title: 'NoteMinder Reminder',
          body: message,
          noteId: note.id
        });
        
        // Update last triggered
        reminder.lastTriggered = new Date().toISOString();
        console.log('    Updated lastTriggered:', reminder.lastTriggered);
        
        // Disable one-time reminders
        if (reminder.type === 'once') {
          reminder.enabled = false;
          console.log('    Disabled one-time reminder');
        }
      }
    });
  });
  
  console.log(`\nSummary: ${dueReminders} due out of ${enabledReminders} enabled (${totalReminders} total)`);
  console.log('=== END CHECKING REMINDERS ===\n');
  
  if (dueReminders > 0) {
    saveNotes();
    renderNotes();
  }
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
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

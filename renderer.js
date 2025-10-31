// State management
let notes = [];
let currentNoteId = null;
let isExpanded = false;
let stayInView = false;

// DOM elements
const arrowTab = document.getElementById('arrow-tab');
const appContainer = document.getElementById('app-container');
const notesContainer = document.getElementById('notes-container');
const addNoteBtn = document.getElementById('add-note-btn');
const noteEditor = document.getElementById('note-editor');
const noteContent = document.getElementById('note-content');
const bgColorPicker = document.getElementById('bg-color-picker');
const addImageBtn = document.getElementById('add-image-btn');
const imageInput = document.getElementById('image-input');
const saveNoteBtn = document.getElementById('save-note-btn');
const cancelNoteBtn = document.getElementById('cancel-note-btn');
const closeEditorBtn = document.getElementById('close-editor-btn');
const editorTitle = document.getElementById('editor-title');

// Formatting buttons
const boldBtn = document.getElementById('bold-btn');
const italicBtn = document.getElementById('italic-btn');
const underlineBtn = document.getElementById('underline-btn');
const strikethroughBtn = document.getElementById('strikethrough-btn');
const h1Btn = document.getElementById('h1-btn');
const h2Btn = document.getElementById('h2-btn');
const h3Btn = document.getElementById('h3-btn');
const codeBtn = document.getElementById('code-btn');
const quoteBtn = document.getElementById('quote-btn');
const ulBtn = document.getElementById('ul-btn');
const olBtn = document.getElementById('ol-btn');
const importMdBtn = document.getElementById('import-md-btn');
const markdownInput = document.getElementById('markdown-input');
const taskBtn = document.getElementById('task-btn');
const linkBtn = document.getElementById('link-btn');
const reminderBtn = document.getElementById('reminder-btn');

// Search elements
const searchInput = document.getElementById('search-input');

// Reminder modal elements
const reminderModal = document.getElementById('reminder-modal');
const reminderType = document.getElementById('reminder-type');
const reminderDate = document.getElementById('reminder-date');
const reminderTime = document.getElementById('reminder-time');
const reminderDay = document.getElementById('reminder-day');
const reminderMessage = document.getElementById('reminder-message');
const weeklyDaySelector = document.getElementById('weekly-day-selector');
const saveReminderBtn = document.getElementById('save-reminder-btn');
const cancelReminderBtn = document.getElementById('cancel-reminder-btn');
const closeReminderBtn = document.getElementById('close-reminder-btn');
const resizeHandle = document.querySelector('.resize-handle');

// Initialize app
async function init() {
  // Hide the loading screen after initialization
  const loadingScreen = document.getElementById('loading-screen');
  
  notes = await window.electronAPI.loadNotes();
  renderNotes();
  setupEventListeners();
  
  // Load and apply theme
  await loadTheme();
  
  // Load stayInView setting
  stayInView = await window.electronAPI.getStayInView();
  
  // Listen for theme changes from tray menu
  window.electronAPI.onThemeChanged((theme) => {
    applyTheme(theme);
  });
  
  // Listen for stayInView changes from tray menu
  window.electronAPI.onStayInViewChanged((enabled) => {
    stayInView = enabled;
    console.log(`Stay in View: ${enabled ? 'enabled' : 'disabled'}`);
  });
  
  // Listen for notification clicks
  window.electronAPI.onNotificationClick((noteId) => {
    // Expand sidebar if collapsed
    if (!isExpanded) {
      toggleSidebar();
    }
    
    // Open the note
    openNoteEditor(noteId);
  });
  
  // Listen for create new note from tray menu
  window.electronAPI.onCreateNewNote(() => {
    // Expand sidebar if collapsed
    if (!isExpanded) {
      toggleSidebar();
    }
    
    // Open new note editor
    openNoteEditor();
  });
  
  // Listen for notes imported event
  window.electronAPI.onNotesImported(async () => {
    // Reload notes from storage
    notes = await window.electronAPI.loadNotes();
    renderNotes();
    
    // Expand sidebar if collapsed to show imported notes
    if (!isExpanded) {
      toggleSidebar();
    }
  });
  
  // Add blur event listener to collapse sidebar when clicking outside
  window.addEventListener('blur', handleWindowBlur);
  
  // Hide loading screen - remove it completely after a brief delay
  setTimeout(() => {
    if (loadingScreen && loadingScreen.parentNode) {
      // Remove from DOM after showing the loader for a moment
      loadingScreen.parentNode.removeChild(loadingScreen);
    }
  }, 1000);
}

// Load theme from settings
async function loadTheme() {
  const theme = await window.electronAPI.getTheme();
  applyTheme(theme);
}

// Apply theme to the UI
function applyTheme(theme) {
  // Remove existing theme classes
  document.body.classList.remove('light-theme', 'dark-theme');
  
  // Add new theme class
  document.body.classList.add(`${theme}-theme`);
  
  console.log(`Theme applied: ${theme}`);
}

// Setup event listeners
function setupEventListeners() {
  // Toggle sidebar
  arrowTab.addEventListener('click', toggleSidebar);
  
  // Header buttons
  addNoteBtn.addEventListener('click', () => openNoteEditor());
  
  // Editor buttons
  saveNoteBtn.addEventListener('click', saveNote);
  cancelNoteBtn.addEventListener('click', closeNoteEditor);
  closeEditorBtn.addEventListener('click', closeNoteEditor);
  
  // Image upload - now handled in dropdown
  imageInput.addEventListener('change', handleImageUpload);
  
  // Markdown import
  importMdBtn.addEventListener('click', () => markdownInput.click());
  markdownInput.addEventListener('change', handleMarkdownImport);
  
  // Formatting buttons
  boldBtn.addEventListener('click', () => formatText('bold'));
  italicBtn.addEventListener('click', () => formatText('italic'));
  underlineBtn.addEventListener('click', () => formatText('underline'));
  
  // Dropdown items
  h1Btn.addEventListener('click', () => { formatBlock('h1'); closeDropdowns(); });
  h2Btn.addEventListener('click', () => { formatBlock('h2'); closeDropdowns(); });
  h3Btn.addEventListener('click', () => { formatBlock('h3'); closeDropdowns(); });
  codeBtn.addEventListener('click', () => { formatInlineCode(); closeDropdowns(); });
  quoteBtn.addEventListener('click', () => { formatBlock('blockquote'); closeDropdowns(); });
  ulBtn.addEventListener('click', () => { formatList('insertUnorderedList'); closeDropdowns(); });
  olBtn.addEventListener('click', () => { formatList('insertOrderedList'); closeDropdowns(); });
  addImageBtn.addEventListener('click', () => { imageInput.click(); closeDropdowns(); });
  
  // Keyboard shortcuts
  noteContent.addEventListener('keydown', handleKeyboardShortcuts);
  
  // Task list button
  taskBtn.addEventListener('click', addTaskList);
  
  // Link button
  linkBtn.addEventListener('click', insertLink);
  
  // Delegate event handling for task checkboxes, delete buttons, and links
  noteContent.addEventListener('click', handleTaskInteraction);
  noteContent.addEventListener('click', handleLinkClick);
  
  // Background color change
  bgColorPicker.addEventListener('input', (e) => {
    const bgColor = e.target.value;
    noteContent.style.backgroundColor = bgColor;
    
    // Adjust text color based on background brightness
    const textColor = isLightColor(bgColor) ? '#2c3e50' : '#ffffff';
    noteContent.style.color = textColor;
  });
  
  // Auto-convert URLs to links
  noteContent.addEventListener('input', autoConvertLinks);
  
  // Enable drag and drop for images in editor
  noteContent.addEventListener('dragover', handleDragOver);
  noteContent.addEventListener('drop', handleDrop);
  
  // Make images draggable within content
  noteContent.addEventListener('mousedown', handleImageDragStart);
  
  // Reminder modal
  reminderBtn.addEventListener('click', openReminderModal);
  closeReminderBtn.addEventListener('click', closeReminderModal);
  cancelReminderBtn.addEventListener('click', closeReminderModal);
  saveReminderBtn.addEventListener('click', saveReminder);
  reminderType.addEventListener('change', handleReminderTypeChange);
  
  // Check reminders periodically
  setInterval(checkReminders, 60000); // Check every minute
  checkReminders(); // Check immediately on load
  
  // Window resizing
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', initResize);
  }
  
  // Search functionality
  searchInput.addEventListener('input', handleSearch);
  
  // Auto H1 formatting for first line
  noteContent.addEventListener('input', handleAutoH1Formatting);
}

// Window resize functionality
let isResizing = false;
let startX = 0;
let startWidth = 0;

function initResize(e) {
  isResizing = true;
  startX = e.clientX;
  startWidth = appContainer.offsetWidth;
  
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  
  // Prevent text selection during resize
  e.preventDefault();
}

async function doResize(e) {
  if (!isResizing) return;
  
  // Calculate new width (resize from left edge, so subtract the difference)
  const diff = startX - e.clientX;
  let newWidth = startWidth + diff;
  
  // Constrain width between min and max
  newWidth = Math.max(300, Math.min(800, newWidth));
  
  // Update container width
  appContainer.style.width = newWidth + 'px';
  
  // Update the right position when expanded
  if (isExpanded) {
    appContainer.style.right = '0px';
  } else {
    appContainer.style.right = `-${newWidth}px`;
  }
  
  // Resize the actual Electron window
  await window.electronAPI.resizeWindow(newWidth, window.innerHeight);
}

function stopResize() {
  isResizing = false;
  document.removeEventListener('mousemove', doResize);
  document.removeEventListener('mouseup', stopResize);
}

// Toggle sidebar
async function toggleSidebar() {
  isExpanded = !isExpanded;
  appContainer.classList.toggle('expanded');
  arrowTab.classList.toggle('expanded');
  document.body.classList.toggle('expanded');
  
  // Resize window based on expanded state
  const screenHeight = window.innerHeight;
  if (!isExpanded) {
    // Collapsed: only show arrow tab (30px width)
    await window.electronAPI.resizeWindow(30, screenHeight);
    setupMouseTracking();
  } else {
    // Expanded: show full app (400px width)
    await window.electronAPI.resizeWindow(400, screenHeight);
    removeMouseTracking();
    await window.electronAPI.setIgnoreMouseEvents(false);
  }
}

// Mouse tracking for arrow tab when collapsed
let mouseTrackingEnabled = false;

function setupMouseTracking() {
  if (mouseTrackingEnabled) return;
  mouseTrackingEnabled = true;
  
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseleave', handleMouseLeave);
  
  // Initially set to ignore mouse events
  window.electronAPI.setIgnoreMouseEvents(true);
}

function removeMouseTracking() {
  if (!mouseTrackingEnabled) return;
  mouseTrackingEnabled = false;
  
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseleave', handleMouseLeave);
}

function handleMouseMove(e) {
  if (isExpanded) return;
  
  // Get arrow tab bounds
  const arrowRect = arrowTab.getBoundingClientRect();
  
  // Check if mouse is over arrow tab (with a small margin)
  const isOverArrow = (
    e.clientX >= arrowRect.left - 5 &&
    e.clientX <= arrowRect.right + 5 &&
    e.clientY >= arrowRect.top - 5 &&
    e.clientY <= arrowRect.bottom + 5
  );
  
  // Toggle click-through based on mouse position
  window.electronAPI.setIgnoreMouseEvents(!isOverArrow);
}

function handleMouseLeave() {
  if (isExpanded) return;
  
  // When mouse leaves window, enable click-through
  window.electronAPI.setIgnoreMouseEvents(true);
}

// Open note editor
function openNoteEditor(noteId = null) {
  currentNoteId = noteId;
  
  if (noteId) {
    const note = notes.find(n => n.id === noteId);
    if (note) {
      editorTitle.textContent = 'Edit Note';
      noteContent.innerHTML = note.content;
      bgColorPicker.value = note.backgroundColor;
      noteContent.style.backgroundColor = note.backgroundColor;
      
      // Set text color based on background
      const textColor = isLightColor(note.backgroundColor) ? '#2c3e50' : '#ffffff';
      noteContent.style.color = textColor;
    }
  } else {
    editorTitle.textContent = 'New Note';
    noteContent.innerHTML = '';
    bgColorPicker.value = '#ffffff';
    noteContent.style.backgroundColor = '#ffffff';
    noteContent.style.color = '#2c3e50';
  }
  
  noteEditor.classList.remove('hidden');
  noteContent.focus();
}

// Close note editor
function closeNoteEditor() {
  noteEditor.classList.add('hidden');
  currentNoteId = null;
  noteContent.innerHTML = '';
  noteContent.style.backgroundColor = '#ffffff';
}

// Helper function to determine if a color is light or dark
function isLightColor(color) {
  // Convert hex to RGB
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5;
}

// Save note
async function saveNote() {
  const content = noteContent.innerHTML.trim();
  
  if (!content) {
    alert('Please add some content to your note');
    return;
  }
  
  const backgroundColor = bgColorPicker.value;
  
  if (currentNoteId) {
    // Update existing note
    const noteIndex = notes.findIndex(n => n.id === currentNoteId);
    if (noteIndex !== -1) {
      notes[noteIndex].content = content;
      notes[noteIndex].backgroundColor = backgroundColor;
      notes[noteIndex].updatedAt = new Date().toISOString();
    }
  } else {
    // Create new note
    const newNote = {
      id: Date.now().toString(),
      content: content,
      backgroundColor: backgroundColor,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    notes.unshift(newNote);
  }
  
  await window.electronAPI.saveNotes(notes);
  renderNotes();
  closeNoteEditor();
}

// Delete note
async function deleteNote(noteId) {
  if (confirm('Are you sure you want to delete this note?')) {
    notes = notes.filter(n => n.id !== noteId);
    await window.electronAPI.saveNotes(notes);
    renderNotes();
  }
}

// Render notes
function renderNotes() {
  if (notes.length === 0) {
    notesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-text">No notes yet. Click + to create one!</div>
      </div>
    `;
    return;
  }
  
  notesContainer.innerHTML = notes.map(note => {
    const date = new Date(note.updatedAt);
    const formattedDate = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Determine text color based on background brightness
    const textColor = isLightColor(note.backgroundColor) ? '#2c3e50' : '#ffffff';
    const dateColor = isLightColor(note.backgroundColor) ? '#666666' : '#e0e0e0';
    
    // Add transparency to background color
    const bgColor = note.backgroundColor;
    const rgbMatch = bgColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    let transparentBg = bgColor;
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 16);
      const g = parseInt(rgbMatch[2], 16);
      const b = parseInt(rgbMatch[3], 16);
      transparentBg = `rgba(${r}, ${g}, ${b}, 0.85)`;
    }
    
    // Check for active reminders
    let reminderBadge = '';
    if (note.reminders && note.reminders.length > 0) {
      const activeReminders = note.reminders.filter(r => r.enabled);
      if (activeReminders.length > 0) {
        const nextReminder = activeReminders[0];
        const reminderTime = `${nextReminder.date} ${nextReminder.time}`;
        const reminderDate = new Date(reminderTime);
        const now = new Date();
        
        // Format reminder display
        let reminderDisplay = '';
        if (nextReminder.type === 'daily') {
          reminderDisplay = `Daily at ${nextReminder.time}`;
        } else if (nextReminder.type === 'weekly') {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          reminderDisplay = `${days[nextReminder.day]} at ${nextReminder.time}`;
        } else {
          const isToday = reminderDate.toDateString() === now.toDateString();
          const isTomorrow = reminderDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
          
          if (isToday) {
            reminderDisplay = `Today at ${nextReminder.time}`;
          } else if (isTomorrow) {
            reminderDisplay = `Tomorrow at ${nextReminder.time}`;
          } else {
            reminderDisplay = `${reminderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${nextReminder.time}`;
          }
        }
        
        reminderBadge = `<div class="reminder-badge" style="color: ${dateColor};">⏰ ${reminderDisplay}</div>`;
      }
    }
    
    return `
      <div class="note-card" style="background-color: ${transparentBg}; color: ${textColor};" data-note-id="${note.id}">
        <div class="note-card-header">
          <span class="note-date" style="color: ${dateColor};">${formattedDate}</span>
          <button class="note-delete" data-note-id="${note.id}">×</button>
        </div>
        ${reminderBadge}
        <div class="note-preview" style="color: ${textColor}; text-shadow: ${isLightColor(note.backgroundColor) ? '0 1px 2px rgba(255, 255, 255, 0.8)' : '0 1px 2px rgba(0, 0, 0, 0.5)'};">${note.content}</div>
      </div>
    `;
  }).join('');
  
  // Add event listeners to note cards
  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('note-delete')) {
        openNoteEditor(card.dataset.noteId);
      }
    });
  });
  
  // Add event listeners to delete buttons
  document.querySelectorAll('.note-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(btn.dataset.noteId);
    });
  });
}

// Handle image upload
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = document.createElement('img');
    img.src = event.target.result;
    img.draggable = true;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '10px 0';
    img.style.borderRadius = '8px';
    
    // Insert image at cursor position or at the end
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.insertNode(img);
      range.collapse(false);
    } else {
      noteContent.appendChild(img);
    }
    
    // Add line break after image
    const br = document.createElement('br');
    img.parentNode.insertBefore(br, img.nextSibling);
  };
  
  reader.readAsDataURL(file);
  imageInput.value = '';
}

// Handle drag over for images
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Handle drop for images
function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = document.createElement('img');
        img.src = event.target.result;
        img.draggable = true;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '10px 0';
        img.style.borderRadius = '8px';
        
        // Insert at drop position
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          range.insertNode(img);
          const br = document.createElement('br');
          img.parentNode.insertBefore(br, img.nextSibling);
        } else {
          noteContent.appendChild(img);
        }
      };
      reader.readAsDataURL(file);
    }
  }
}

// Handle image drag start for repositioning
let draggedImage = null;
let draggedImagePlaceholder = null;

function handleImageDragStart(e) {
  if (e.target.tagName === 'IMG') {
    draggedImage = e.target;
    draggedImage.classList.add('dragging');
    
    // Create placeholder
    draggedImagePlaceholder = document.createElement('div');
    draggedImagePlaceholder.style.height = draggedImage.offsetHeight + 'px';
    draggedImagePlaceholder.style.backgroundColor = '#f0f0f0';
    draggedImagePlaceholder.style.border = '2px dashed #ccc';
    draggedImagePlaceholder.style.borderRadius = '8px';
    draggedImagePlaceholder.style.margin = '10px 0';
    
    document.addEventListener('mousemove', handleImageDrag);
    document.addEventListener('mouseup', handleImageDragEnd);
  }
}

function handleImageDrag(e) {
  if (!draggedImage) return;
  
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (range && range.startContainer.parentElement === noteContent) {
    // Insert placeholder at new position
    if (draggedImagePlaceholder.parentNode) {
      draggedImagePlaceholder.remove();
    }
    range.insertNode(draggedImagePlaceholder);
  }
}

function handleImageDragEnd(e) {
  if (!draggedImage) return;
  
  draggedImage.classList.remove('dragging');
  
  // Move image to placeholder position
  if (draggedImagePlaceholder.parentNode) {
    draggedImagePlaceholder.parentNode.insertBefore(draggedImage, draggedImagePlaceholder);
    draggedImagePlaceholder.remove();
  }
  
  draggedImage = null;
  draggedImagePlaceholder = null;
  
  document.removeEventListener('mousemove', handleImageDrag);
  document.removeEventListener('mouseup', handleImageDragEnd);
}

// Format text (bold, italic, underline, strikethrough)
function formatText(command) {
  document.execCommand(command, false, null);
  noteContent.focus();
}

// Format block elements (headings, blockquote)
function formatBlock(tag) {
  document.execCommand('formatBlock', false, tag);
  noteContent.focus();
}

// Format inline code
function formatInlineCode() {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    if (selectedText) {
      const code = document.createElement('code');
      code.textContent = selectedText;
      range.deleteContents();
      range.insertNode(code);
      
      // Move cursor after the code element
      range.setStartAfter(code);
      range.setEndAfter(code);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  noteContent.focus();
}

// Format lists
function formatList(command) {
  document.execCommand(command, false, null);
  noteContent.focus();
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
  if (e.ctrlKey || e.metaKey) {
    switch(e.key.toLowerCase()) {
      case 'b':
        e.preventDefault();
        formatText('bold');
        break;
      case 'i':
        e.preventDefault();
        formatText('italic');
        break;
      case 'u':
        e.preventDefault();
        formatText('underline');
        break;
    }
  }
}

// Handle markdown import
function handleMarkdownImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const markdown = event.target.result;
    const html = convertMarkdownToHTML(markdown);
    noteContent.innerHTML = html;
  };
  
  reader.readAsText(file);
  markdownInput.value = '';
}

// Convert Markdown to HTML
function convertMarkdownToHTML(markdown) {
  let html = markdown;
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
  
  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Blockquotes
  html = html.replace(/^\> (.+)$/gim, '<blockquote>$1</blockquote>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0;">');
  
  // Unordered lists
  html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
  html = html.replace(/^- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');
  
  // Line breaks
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// Add task list
function addTaskList() {
  const taskListHTML = `
    <div class="task-section" contenteditable="false">
      <div class="task-section-title">📋 To Do</div>
      <div class="task-list todo-list">
        <div class="task-item" data-task-id="${Date.now()}">
          <div class="task-checkbox"></div>
          <div class="task-text" contenteditable="true">New task - click to edit</div>
          <button class="task-delete">×</button>
        </div>
      </div>
      <div class="add-task-btn" style="margin-top: 10px; color: #667eea; cursor: pointer; font-size: 13px; font-weight: 600;">+ Add Task</div>
    </div>
    <div class="task-section" contenteditable="false" style="display: none;">
      <div class="task-section-title">✅ Done</div>
      <div class="task-list done-list"></div>
    </div>
  `;
  
  // Insert at cursor position or at the end
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = taskListHTML;
    
    while (tempDiv.firstChild) {
      range.insertNode(tempDiv.firstChild);
    }
  } else {
    noteContent.insertAdjacentHTML('beforeend', taskListHTML);
  }
  
  // Add event listener for "Add Task" button
  setupTaskListeners();
  noteContent.focus();
}

// Setup task list event listeners
function setupTaskListeners() {
  const addTaskBtns = noteContent.querySelectorAll('.add-task-btn');
  addTaskBtns.forEach(btn => {
    btn.onclick = function(e) {
      e.stopPropagation();
      const taskSection = this.closest('.task-section');
      const todoList = taskSection.querySelector('.todo-list');
      
      const newTask = document.createElement('div');
      newTask.className = 'task-item';
      newTask.dataset.taskId = Date.now();
      newTask.innerHTML = `
        <div class="task-checkbox"></div>
        <div class="task-text" contenteditable="true">New task - click to edit</div>
        <button class="task-delete">×</button>
      `;
      
      todoList.appendChild(newTask);
      
      // Focus on the new task text
      const taskText = newTask.querySelector('.task-text');
      taskText.focus();
      
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(taskText);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
  });
}

// Handle task interactions (checkbox, delete)
function handleTaskInteraction(e) {
  const target = e.target;
  
  // Handle checkbox click
  if (target.classList.contains('task-checkbox')) {
    e.stopPropagation();
    const taskItem = target.closest('.task-item');
    const taskSection = target.closest('.task-section');
    const isChecked = target.classList.contains('checked');
    
    if (!isChecked) {
      // Mark as completed and move to done section
      target.classList.add('checked');
      taskItem.classList.add('completed');
      
      // Find or show the done section
      let doneSection = taskSection.nextElementSibling;
      if (doneSection && doneSection.classList.contains('task-section')) {
        doneSection.style.display = 'block';
        const doneList = doneSection.querySelector('.done-list');
        
        // Move task to done list with animation
        setTimeout(() => {
          doneList.appendChild(taskItem);
        }, 300);
      }
    } else {
      // Uncheck and move back to todo
      target.classList.remove('checked');
      taskItem.classList.remove('completed');
      
      // Find the todo section
      let todoSection = taskSection.previousElementSibling;
      if (!todoSection || !todoSection.classList.contains('task-section')) {
        todoSection = taskSection;
      }
      
      const todoList = todoSection.querySelector('.todo-list');
      if (todoList) {
        todoList.appendChild(taskItem);
      }
      
      // Hide done section if empty
      const doneList = taskSection.querySelector('.done-list');
      if (doneList && doneList.children.length === 0) {
        taskSection.style.display = 'none';
      }
    }
  }
  
  // Handle delete button click
  if (target.classList.contains('task-delete')) {
    e.stopPropagation();
    const taskItem = target.closest('.task-item');
    const taskList = taskItem.closest('.task-list');
    
    // Remove task with animation
    taskItem.style.opacity = '0';
    taskItem.style.transform = 'translateX(-20px)';
    
    setTimeout(() => {
      taskItem.remove();
      
      // Hide done section if empty
      if (taskList.classList.contains('done-list') && taskList.children.length === 0) {
        const doneSection = taskList.closest('.task-section');
        if (doneSection) {
          doneSection.style.display = 'none';
        }
      }
    }, 300);
  }
  
  // Handle "Add Task" button
  if (target.classList.contains('add-task-btn')) {
    setupTaskListeners();
  }
}

// Insert link
function insertLink() {
  const url = prompt('Enter URL:');
  if (!url) return;
  
  const selection = window.getSelection();
  let linkText = '';
  
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    linkText = range.toString();
  }
  
  if (!linkText) {
    linkText = prompt('Enter link text:', url);
    if (!linkText) return;
  }
  
  // Create link element
  const link = document.createElement('a');
  link.href = url;
  link.textContent = linkText;
  link.setAttribute('data-tooltip', '⌘+Click to open');
  link.setAttribute('contenteditable', 'false');
  
  // Insert link
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(link);
    
    // Add space after link
    const space = document.createTextNode(' ');
    link.parentNode.insertBefore(space, link.nextSibling);
    
    // Move cursor after the space
    range.setStartAfter(space);
    range.setEndAfter(space);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    noteContent.appendChild(link);
    const space = document.createTextNode(' ');
    noteContent.appendChild(space);
  }
  
  noteContent.focus();
}

// Handle link clicks
function handleLinkClick(e) {
  const target = e.target;
  
  // Check if clicked element is a link
  if (target.tagName === 'A' && target.href) {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if Cmd (Mac) or Ctrl (Windows/Linux) key is pressed
    if (e.metaKey || e.ctrlKey) {
      // Open link in default browser
      window.electronAPI.openExternal(target.href);
    }
  }
}

// Update markdown converter to add tooltip to links
function convertMarkdownToHTML(markdown) {
  let html = markdown;
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
  
  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Blockquotes
  html = html.replace(/^\> (.+)$/gim, '<blockquote>$1</blockquote>');
  
  // Links (updated to include tooltip)
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" data-tooltip="⌘+Click to open" contenteditable="false">$1</a>');
  
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0;">');
  
  // Unordered lists
  html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
  html = html.replace(/^- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');
  
  // Line breaks
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// Auto-convert URLs to clickable links
function autoConvertLinks() {
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  
  // Get all text nodes in the content
  const walker = document.createTreeWalker(
    noteContent,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip if parent is already a link or in a code block
        if (node.parentElement.tagName === 'A' || 
            node.parentElement.tagName === 'CODE' ||
            node.parentElement.tagName === 'PRE') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  
  // Process each text node
  textNodes.forEach(textNode => {
    const text = textNode.textContent;
    const matches = text.match(urlRegex);
    
    if (matches) {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      
      matches.forEach(url => {
        const index = text.indexOf(url, lastIndex);
        
        // Add text before URL
        if (index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, index)));
        }
        
        // Create link element
        const link = document.createElement('a');
        link.href = url;
        link.textContent = url;
        link.setAttribute('data-tooltip', '⌘+Click to open');
        link.setAttribute('contenteditable', 'false');
        fragment.appendChild(link);
        
        lastIndex = index + url.length;
      });
      
      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      
      // Replace text node with fragment
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  });
}

// Reminder functions
function openReminderModal(e) {
  // Prevent event from bubbling up
  if (e) {
    e.stopPropagation();
  }
  
  const content = noteContent.innerHTML.trim();
  if (!content) {
    alert('Please add some content to your note before setting a reminder');
    return;
  }
  
  // Check if note has existing reminder
  let existingReminder = null;
  if (currentNoteId) {
    const note = notes.find(n => n.id === currentNoteId);
    if (note && note.reminders && note.reminders.length > 0) {
      // Get the first active reminder
      existingReminder = note.reminders.find(r => r.enabled);
    }
  }
  
  if (existingReminder) {
    // Load existing reminder data
    reminderType.value = existingReminder.type;
    reminderDate.value = existingReminder.date;
    reminderTime.value = existingReminder.time;
    reminderMessage.value = existingReminder.message || '';
    
    if (existingReminder.type === 'weekly') {
      weeklyDaySelector.style.display = 'block';
      reminderDay.value = existingReminder.day.toString();
    } else {
      weeklyDaySelector.style.display = 'none';
    }
  } else {
    // Set default date to today
    const today = new Date();
    reminderDate.value = today.toISOString().split('T')[0];
    
    // Set default time to 1 hour from now
    const oneHourLater = new Date(today.getTime() + 60 * 60 * 1000);
    reminderTime.value = oneHourLater.toTimeString().slice(0, 5);
    
    reminderType.value = 'once';
    reminderMessage.value = '';
    weeklyDaySelector.style.display = 'none';
  }
  
  reminderModal.classList.remove('hidden');
}

function closeReminderModal() {
  reminderModal.classList.add('hidden');
}

function handleReminderTypeChange() {
  if (reminderType.value === 'weekly') {
    weeklyDaySelector.style.display = 'block';
    reminderDay.value = new Date().getDay().toString();
  } else {
    weeklyDaySelector.style.display = 'none';
  }
}

async function saveReminder() {
  const type = reminderType.value;
  const date = reminderDate.value;
  const time = reminderTime.value;
  const message = reminderMessage.value || 'Check your note';
  const day = reminderDay.value;
  
  if (!date || !time) {
    alert('Please select both date and time');
    return;
  }
  
  // If this is a new note, save it first
  if (!currentNoteId) {
    const content = noteContent.innerHTML.trim();
    const backgroundColor = bgColorPicker.value;
    
    const newNote = {
      id: Date.now().toString(),
      content: content,
      backgroundColor: backgroundColor,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reminders: []
    };
    
    notes.unshift(newNote);
    currentNoteId = newNote.id;
    
    // Update editor title
    editorTitle.textContent = 'Edit Note';
  }
  
  const note = notes.find(n => n.id === currentNoteId);
  if (!note) return;
  
  // Initialize reminders array if it doesn't exist
  if (!note.reminders) {
    note.reminders = [];
  }
  
  // Check if there's an existing active reminder to update
  const existingReminderIndex = note.reminders.findIndex(r => r.enabled);
  
  // Create reminder object
  const reminder = {
    id: existingReminderIndex >= 0 ? note.reminders[existingReminderIndex].id : Date.now().toString(),
    noteId: currentNoteId,
    type: type,
    date: date,
    time: time,
    day: type === 'weekly' ? parseInt(day) : null,
    message: message,
    enabled: true,
    lastTriggered: null
  };
  
  if (existingReminderIndex >= 0) {
    // Update existing reminder
    note.reminders[existingReminderIndex] = reminder;
  } else {
    // Add new reminder
    note.reminders.push(reminder);
  }
  
  // Save notes with reminder
  await window.electronAPI.saveNotes(notes);
  
  // Update the notes list display
  renderNotes();
  
  // Schedule the reminder
  await window.electronAPI.scheduleReminder(reminder);
  
  closeReminderModal();
  
  console.log('Reminder saved:', reminder);
  console.log('Current system time:', new Date().toString());
}

async function checkReminders() {
  const now = new Date();
  console.log('=== CHECKING REMINDERS ===');
  console.log('Current time:', now.toString());
  console.log('Total notes:', notes.length);
  
  let remindersChecked = 0;
  let remindersTriggered = 0;
  
  for (const note of notes) {
    if (!note.reminders) continue;
    
    console.log(`Note ${note.id} has ${note.reminders.length} reminder(s)`);
    
    for (const reminder of note.reminders) {
      remindersChecked++;
      console.log('Checking reminder:', {
        id: reminder.id,
        type: reminder.type,
        date: reminder.date,
        time: reminder.time,
        enabled: reminder.enabled,
        lastTriggered: reminder.lastTriggered
      });
      
      if (!reminder.enabled) {
        console.log('  -> Reminder disabled, skipping');
        continue;
      }
      
      const shouldTrigger = checkIfReminderShouldTrigger(reminder, now);
      console.log('  -> Should trigger:', shouldTrigger);
      
      if (shouldTrigger) {
        remindersTriggered++;
        console.log('  -> TRIGGERING NOTIFICATION!');
        
        // Show notification
        const result = await window.electronAPI.showNotification({
          title: reminder.message,
          body: 'Click to open note',
          noteId: note.id
        });
        
        console.log('  -> Notification result:', result);
        
        // Update last triggered time
        reminder.lastTriggered = now.toISOString();
        
        // Disable one-time reminders after triggering
        if (reminder.type === 'once') {
          reminder.enabled = false;
          console.log('  -> One-time reminder disabled');
        }
        
        await window.electronAPI.saveNotes(notes);
        console.log('  -> Notes saved');
      }
    }
  }
  
  console.log(`Checked ${remindersChecked} reminder(s), triggered ${remindersTriggered}`);
  console.log('==========================');
}

function checkIfReminderShouldTrigger(reminder, now) {
  const [hours, minutes] = reminder.time.split(':').map(Number);
  
  console.log('     Reminder time breakdown:', {
    reminderDate: reminder.date,
    reminderTime: reminder.time,
    hours: hours,
    minutes: minutes,
    nowHours: now.getHours(),
    nowMinutes: now.getMinutes(),
    nowDate: now.toISOString().split('T')[0]
  });
  
  // For one-time reminders
  if (reminder.type === 'once') {
    const reminderDateTime = new Date(reminder.date);
    reminderDateTime.setHours(hours, minutes, 0, 0);
    
    const nowDate = now.toISOString().split('T')[0];
    const isRightDate = reminder.date === nowDate;
    const isRightTime = now.getHours() === hours && now.getMinutes() === minutes;
    
    console.log('     One-time reminder check:', {
      isRightDate: isRightDate,
      isRightTime: isRightTime,
      notTriggered: !reminder.lastTriggered,
      reminderDate: reminder.date,
      nowDate: nowDate
    });
    
    // Check if it's the right date and time and hasn't been triggered yet
    if (isRightDate && isRightTime && !reminder.lastTriggered) {
      return true;
    }
  }
  
  // For daily reminders
  if (reminder.type === 'daily') {
    const isRightTime = now.getHours() === hours && now.getMinutes() === minutes;
    
    console.log('     Daily reminder check:', {
      isRightTime: isRightTime,
      hoursMatch: now.getHours() === hours,
      minutesMatch: now.getMinutes() === minutes
    });
    
    // Check if it's the right time
    if (isRightTime) {
      // Check if it hasn't been triggered today
      if (!reminder.lastTriggered) return true;
      
      const lastTrigger = new Date(reminder.lastTriggered);
      const lastTriggerDate = lastTrigger.toISOString().split('T')[0];
      const nowDate = now.toISOString().split('T')[0];
      
      console.log('     Last trigger check:', {
        lastTriggered: reminder.lastTriggered,
        lastTriggerDate: lastTriggerDate,
        nowDate: nowDate,
        differentDay: lastTriggerDate !== nowDate
      });
      
      // Only trigger once per day (check if it's a different day)
      if (lastTriggerDate !== nowDate) {
        return true;
      }
    }
  }
  
  // For weekly reminders
  if (reminder.type === 'weekly') {
    const isRightDay = now.getDay() === reminder.day;
    const isRightTime = now.getHours() === hours && now.getMinutes() === minutes;
    
    console.log('     Weekly reminder check:', {
      isRightDay: isRightDay,
      isRightTime: isRightTime,
      nowDay: now.getDay(),
      reminderDay: reminder.day
    });
    
    // Check if it's the right day and time
    if (isRightDay && isRightTime) {
      // Check if it hasn't been triggered this week
      if (!reminder.lastTriggered) return true;
      
      const lastTrigger = new Date(reminder.lastTriggered);
      const timeSinceLastTrigger = now - lastTrigger;
      
      console.log('     Last trigger check:', {
        lastTriggered: reminder.lastTriggered,
        timeSinceLastTrigger: timeSinceLastTrigger,
        daysAgo: timeSinceLastTrigger / (24 * 60 * 60 * 1000)
      });
      
      // Only trigger once per week (if more than 6 days have passed)
      if (timeSinceLastTrigger > 6 * 24 * 60 * 60 * 1000) {
        return true;
      }
    }
  }
  
  return false;
}

// Close all dropdowns
function closeDropdowns() {
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(dropdown => {
    dropdown.classList.remove('active');
  });
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    closeDropdowns();
  }
});

// Search functionality
function handleSearch(e) {
  const searchTerm = e.target.value.toLowerCase().trim();
  
  if (!searchTerm) {
    renderNotes();
    return;
  }
  
  // Filter notes based on search term
  const filteredNotes = notes.filter(note => {
    const textContent = note.content.replace(/<[^>]*>/g, '').toLowerCase();
    return textContent.includes(searchTerm);
  });
  
  // Render filtered notes
  if (filteredNotes.length === 0) {
    notesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">No notes found matching "${e.target.value}"</div>
      </div>
    `;
    return;
  }
  
  notesContainer.innerHTML = filteredNotes.map(note => {
    const date = new Date(note.updatedAt);
    const formattedDate = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const textColor = isLightColor(note.backgroundColor) ? '#2c3e50' : '#ffffff';
    const dateColor = isLightColor(note.backgroundColor) ? '#666666' : '#e0e0e0';
    
    const bgColor = note.backgroundColor;
    const rgbMatch = bgColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    let transparentBg = bgColor;
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 16);
      const g = parseInt(rgbMatch[2], 16);
      const b = parseInt(rgbMatch[3], 16);
      transparentBg = `rgba(${r}, ${g}, ${b}, 0.85)`;
    }
    
    // Highlight search term in preview
    let preview = note.content;
    const textOnly = preview.replace(/<[^>]*>/g, '');
    const highlightedText = textOnly.replace(
      new RegExp(searchTerm, 'gi'),
      match => `<mark style="background: #ffeb3b; padding: 2px 4px; border-radius: 2px;">${match}</mark>`
    );
    
    return `
      <div class="note-card" style="background-color: ${transparentBg}; color: ${textColor};" data-note-id="${note.id}">
        <div class="note-card-header">
          <span class="note-date" style="color: ${dateColor};">${formattedDate}</span>
          <button class="note-delete" data-note-id="${note.id}">×</button>
        </div>
        <div class="note-preview" style="color: ${textColor};">${highlightedText}</div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('note-delete')) {
        openNoteEditor(card.dataset.noteId);
      }
    });
  });
  
  document.querySelectorAll('.note-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(btn.dataset.noteId);
    });
  });
}


// Auto H1 formatting for first line
function handleAutoH1Formatting() {
  // Get the first line of content
  const firstChild = noteContent.firstChild;
  
  if (!firstChild) return;
  
  // Check if first element is already an H1
  if (firstChild.nodeName === 'H1') return;
  
  // If first element is a text node or other element, check if it contains text
  if (firstChild.nodeType === Node.TEXT_NODE) {
    const text = firstChild.textContent.trim();
    if (text) {
      // Get the first line (up to first line break)
      const firstLine = text.split('\n')[0].trim();
      
      if (firstLine && firstLine.length > 0) {
        // Create H1 element
        const h1 = document.createElement('h1');
        h1.textContent = firstLine;
        
        // Replace first line with H1
        const remainingText = text.substring(firstLine.length).trim();
        
        // Remove the text node
        noteContent.removeChild(firstChild);
        
        // Insert H1 at the beginning
        noteContent.insertBefore(h1, noteContent.firstChild);
        
        // Add remaining text if any
        if (remainingText) {
          const textNode = document.createTextNode('\n' + remainingText);
          h1.parentNode.insertBefore(textNode, h1.nextSibling);
        }
      }
    }
  } else if (firstChild.nodeName !== 'H1' && firstChild.nodeName !== 'H2' && firstChild.nodeName !== 'H3') {
    // If first element is not a heading, convert it to H1 if it has text
    const text = firstChild.textContent.trim();
    if (text) {
      const h1 = document.createElement('h1');
      h1.innerHTML = firstChild.innerHTML;
      noteContent.replaceChild(h1, firstChild);
    }
  }
}

// Handle window blur (clicking outside)
function handleWindowBlur() {
  // Don't collapse if a modal is open
  const isModalOpen = !reminderModal.classList.contains('hidden');
  
  // Only collapse if stayInView is disabled, sidebar is expanded, and no modal is open
  if (!stayInView && isExpanded && !isModalOpen) {
    console.log('Window blurred - collapsing sidebar');
    toggleSidebar();
  }
}

// Initialize the app
init();

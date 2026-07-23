const { ipcRenderer } = require('electron');
const PasswordManager = require('./utils/passwordManager');

// State
let notes = [];
let passwords = [];
let filteredResults = []; // Combined notes and passwords
let selectedIndex = -1;
let passwordManager = new PasswordManager();

// DOM Elements
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results-container');

// Initialize
async function init() {
  await loadNotes();
  await loadPasswords();
  setupEventListeners();
}

async function loadNotes() {
  notes = await ipcRenderer.invoke('get-notes');
}

async function loadPasswords() {
  passwords = await passwordManager.loadPasswords();
}

function setupEventListeners() {
  // Search input
  searchInput.addEventListener('input', handleSearch);
  
  // Keyboard navigation
  searchInput.addEventListener('keydown', handleKeyDown);
  
  // IPC listeners
  ipcRenderer.on('focus-search', () => {
    searchInput.focus();
    searchInput.select();
  });
}

function handleSearch(e) {
  const query = e.target.value.trim();

  if (!query) {
    showEmptyState();
    return;
  }

  const lowerQuery = query.toLowerCase();

  // Match notes on title OR content. Track titleMatch so title hits rank first.
  const matchedNotes = notes.reduce((acc, note) => {
    const title = (note.title || '').toLowerCase();
    const content = stripHtml(note.content).toLowerCase();
    const titleMatch = title.includes(lowerQuery);
    const contentMatch = content.includes(lowerQuery);
    if (titleMatch || contentMatch) {
      acc.push({ type: 'note', data: note, titleMatch });
    }
    return acc;
  }, []);

  const matchedPasswords = passwords.filter(password => {
    const label = (password.label || '').toLowerCase();
    return label.includes(lowerQuery);
  }).map(password => ({ type: 'password', data: password, titleMatch: true }));

  filteredResults = [...matchedNotes, ...matchedPasswords];

  // Sort: favorites first, then title matches above content matches, then recency.
  filteredResults.sort((a, b) => {
    const aFav = a.data.isFavorite || false;
    const bFav = b.data.isFavorite || false;
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;

    if (a.titleMatch && !b.titleMatch) return -1;
    if (!a.titleMatch && b.titleMatch) return 1;

    const aDate = new Date(a.data.updated || a.data.created);
    const bDate = new Date(b.data.updated || b.data.created);
    return bDate - aDate;
  });

  selectedIndex = filteredResults.length > 0 ? 0 : -1;
  renderResults(query);
}

function handleKeyDown(e) {
  switch (e.key) {
    case 'Escape':
      closeWindow();
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (filteredResults.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredResults.length;
        updateSelection();
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (filteredResults.length > 0) {
        selectedIndex = selectedIndex <= 0 ? filteredResults.length - 1 : selectedIndex - 1;
        updateSelection();
      }
      break;
    case 'Enter':
      e.preventDefault();
      if (selectedIndex >= 0 && filteredResults[selectedIndex]) {
        handleResultAction(filteredResults[selectedIndex]);
      }
      break;
  }
}

function renderResults(query) {
  resultsContainer.innerHTML = '';
  
  if (filteredResults.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <div class="empty-state-icon">🔍</div>
      <div class="empty-state-text">No results found</div>
    `;
    resultsContainer.appendChild(emptyState);
    return;
  }
  
  filteredResults.forEach((result, index) => {
    const resultItem = result.type === 'note' 
      ? createNoteResultItem(result.data, query, index === selectedIndex)
      : createPasswordResultItem(result.data, query, index === selectedIndex);
    resultsContainer.appendChild(resultItem);
  });
}

function handleResultAction(result) {
  if (result.type === 'note') {
    openNote(result.data.id);
  } else if (result.type === 'password') {
    // For passwords, copy to clipboard
    copyPassword(result.data);
  }
}

async function copyPassword(password) {
  try {
    const result = await passwordManager.getDecryptedPassword(password.id);
    if (result.success && result.data.password) {
      await navigator.clipboard.writeText(result.data.password);
      showToast('Password copied to clipboard');
      // Close window after a brief delay
      setTimeout(() => closeWindow(), 500);
    } else {
      showToast('Failed to decrypt password', 'error');
    }
  } catch (error) {
    console.error('Error copying password:', error);
    showToast('Failed to copy password', 'error');
  }
}

function createNoteResultItem(note, query, isSelected) {
  const item = document.createElement('div');
  item.className = 'result-item';
  if (isSelected) {
    item.classList.add('selected');
  }

  const rawTitle = (note.title || '').trim() || 'Untitled';
  const title = query ? highlightText(rawTitle, query) : rawTitle;

  let snippet = stripHtml(note.content).replace(/\s+/g, ' ').trim();
  if (snippet.length > 120) snippet = snippet.substring(0, 120) + '…';
  if (query && snippet) snippet = highlightText(snippet, query);

  let icon = '📝';
  if (note.isFavorite) {
    icon = '⭐';
  } else if (note.reminders && note.reminders.some(r => r.enabled)) {
    icon = '🔔';
  }

  item.innerHTML = `
    <div class="result-icon">${icon}</div>
    <div class="result-details">
      <div class="result-title">${title}</div>
      ${snippet ? `<div class="result-subtitle">${snippet}</div>` : ''}
    </div>
  `;
  
  // Click handler
  item.addEventListener('click', () => {
    openNote(note.id);
  });
  
  // Hover handler
  item.addEventListener('mouseenter', () => {
    selectedIndex = filteredResults.findIndex(r => r.type === 'note' && r.data.id === note.id);
    updateSelection();
  });
  
  return item;
}

function createPasswordResultItem(password, query, isSelected) {
  const item = document.createElement('div');
  item.className = 'result-item password-result';
  if (isSelected) {
    item.classList.add('selected');
  }
  
  // Get label
  let label = password.label || 'Untitled Password';
  
  // Highlight search query in label
  if (query) {
    label = highlightText(label, query);
  }
  
  // Build icon
  const icon = password.isFavorite ? '⭐' : '🔐';
  
  // Subtitle - show username if available
  let subtitle = '';
  if (password.username) {
    subtitle = `<div class="result-subtitle">${password.username}</div>`;
  }
  
  item.innerHTML = `
    <div class="result-icon">${icon}</div>
    <div class="result-details">
      <div class="result-title">${label}</div>
      ${subtitle}
    </div>
    <button class="copy-password-btn" title="Copy password">📋</button>
  `;
  
  const copyBtn = item.querySelector('.copy-password-btn');
  
  // Click handler for copy button
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyPassword(password);
  });
  
  // Click handler for item (also copies)
  item.addEventListener('click', async () => {
    await copyPassword(password);
  });
  
  // Hover handler
  item.addEventListener('mouseenter', () => {
    selectedIndex = filteredResults.findIndex(r => r.type === 'password' && r.data.id === password.id);
    updateSelection();
  });
  
  return item;
}

function updateSelection() {
  const items = resultsContainer.querySelectorAll('.result-item');
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function openNote(noteId) {
  ipcRenderer.send('open-note-from-search', noteId);
}

function closeWindow() {
  searchInput.value = '';
  showEmptyState();
  ipcRenderer.send('close-search-window');
}

function showEmptyState() {
  resultsContainer.innerHTML = '';

  const recent = [...notes]
    .sort((a, b) => new Date(b.updated || b.created) - new Date(a.updated || a.created))
    .slice(0, 5);

  if (recent.length === 0) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-text">No notes yet</div>
      </div>
    `;
    filteredResults = [];
    selectedIndex = -1;
    return;
  }

  const header = document.createElement('div');
  header.className = 'results-section-header';
  header.textContent = 'Recent';
  resultsContainer.appendChild(header);

  filteredResults = recent.map(note => ({ type: 'note', data: note, titleMatch: true }));
  selectedIndex = 0;

  filteredResults.forEach((result, index) => {
    const item = createNoteResultItem(result.data, '', index === selectedIndex);
    resultsContainer.appendChild(item);
  });
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '4px';
  toast.style.backgroundColor = type === 'error' ? '#f44336' : '#4caf50';
  toast.style.color = 'white';
  toast.style.fontSize = '14px';
  toast.style.zIndex = '10000';
  toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 2000);
}

// Utility functions
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  
  // Handle password fields specially - remove completely from preview
  const passwordFields = tmp.querySelectorAll('.password-field-container');
  passwordFields.forEach(field => {
    field.remove();
  });
  
  // Also remove any stray password field related content
  const passwordFieldElements = tmp.querySelectorAll('[class*="password-field"]');
  passwordFieldElements.forEach(el => {
    el.remove();
  });
  
  return tmp.textContent || tmp.innerText || '';
}

function highlightText(text, query) {
  if (!query) return text;
  
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDate(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (days < 7) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

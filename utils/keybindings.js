// Central registry of every remappable shortcut in the app, plus the pure
// (no-Electron-API) logic to resolve, match, and format them. Required
// directly by both the main process (for the two OS-level global shortcuts)
// and the renderer (for in-app editor/navigation shortcuts) — nodeIntegration
// is on and this file has no dependency on which process it runs in.

const isMac = process.platform === 'darwin';

// scope: 'global' (registered with Electron's globalShortcut, OS-wide),
// 'app' (renderer-level document keydown), 'editor' (inside the note body).
const ACTIONS = [
  { id: 'globalSearch', label: 'Open search (from anywhere)', group: 'Global', scope: 'global', default: ['Mod', 'Shift', 'Space'] },
  { id: 'globalClip', label: 'Save clipboard as a clip (from anywhere)', group: 'Global', scope: 'global', default: ['Mod', 'Shift', 'V'] },

  { id: 'newNote', label: 'New note', group: 'Navigation', scope: 'app', default: ['Mod', 'N'] },
  { id: 'findInNote', label: 'Find in note', group: 'Navigation', scope: 'app', default: ['Mod', 'F'] },
  { id: 'showShortcuts', label: 'Show this shortcuts panel', group: 'Navigation', scope: 'app', default: ['Mod', '/'] },
  { id: 'collapseSidebar', label: 'Collapse the sidebar', group: 'Navigation', scope: 'app', default: ['H'] },
  { id: 'toggleFocusMode', label: 'Toggle Focus Mode', group: 'Navigation', scope: 'app', default: ['Mod', 'Shift', 'F'] },

  { id: 'bold', label: 'Bold', group: 'Formatting', scope: 'editor', default: ['Mod', 'B'] },
  { id: 'italic', label: 'Italic', group: 'Formatting', scope: 'editor', default: ['Mod', 'I'] },
  { id: 'underline', label: 'Underline', group: 'Formatting', scope: 'editor', default: ['Mod', 'U'] },
  { id: 'strikethrough', label: 'Strikethrough', group: 'Formatting', scope: 'editor', default: ['Mod', 'Shift', 'X'] },
  { id: 'highlight', label: 'Highlight', group: 'Formatting', scope: 'editor', default: ['Mod', 'Shift', 'H'] },
  { id: 'inlineCode', label: 'Inline code', group: 'Formatting', scope: 'editor', default: ['Mod', 'E'] },
  { id: 'insertLink', label: 'Insert link', group: 'Formatting', scope: 'editor', default: ['Mod', 'K'] },
  { id: 'undo', label: 'Undo', group: 'Formatting', scope: 'editor', default: ['Mod', 'Z'] },
  { id: 'redo', label: 'Redo', group: 'Formatting', scope: 'editor', default: ['Mod', 'Shift', 'Z'] },

  { id: 'headingNormal', label: 'Normal text', group: 'Blocks', scope: 'editor', default: ['Mod', 'Alt', '0'] },
  { id: 'heading1', label: 'Heading 1', group: 'Blocks', scope: 'editor', default: ['Mod', 'Alt', '1'] },
  { id: 'heading2', label: 'Heading 2', group: 'Blocks', scope: 'editor', default: ['Mod', 'Alt', '2'] },
  { id: 'heading3', label: 'Heading 3', group: 'Blocks', scope: 'editor', default: ['Mod', 'Alt', '3'] },
  { id: 'numberedList', label: 'Numbered list', group: 'Blocks', scope: 'editor', default: ['Mod', 'Shift', '7'] },
  { id: 'bulletList', label: 'Bullet list', group: 'Blocks', scope: 'editor', default: ['Mod', 'Shift', '8'] },
  { id: 'taskList', label: 'Task list', group: 'Blocks', scope: 'editor', default: ['Mod', 'Shift', '9'] }
];

// Keys a shortcut is allowed to end in — deliberately narrow to what the
// app's own shortcuts already use, so the recorder can't produce something
// that silently breaks typing (e.g. a bare Escape/Tab).
const ALLOWED_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  'Space',
  '/'
]);

function tokensToBinding(tokens) {
  const binding = { meta: false, ctrl: false, alt: false, shift: false, key: null };
  tokens.forEach((t) => {
    switch (t) {
      case 'Mod':
        if (isMac) binding.meta = true; else binding.ctrl = true;
        break;
      case 'Cmd':
        binding.meta = true;
        break;
      case 'Ctrl':
        binding.ctrl = true;
        break;
      case 'Alt':
        binding.alt = true;
        break;
      case 'Shift':
        binding.shift = true;
        break;
      default:
        binding.key = t;
    }
  });
  return binding;
}

function getAction(actionId) {
  return ACTIONS.find((a) => a.id === actionId) || null;
}

function getDefaultBinding(actionId) {
  const action = getAction(actionId);
  return action ? tokensToBinding(action.default) : null;
}

// Merges user overrides (as stored: { [actionId]: binding }) over the
// built-in defaults, returning the full effective { [actionId]: binding } map.
function resolveBindings(overrides = {}) {
  const map = {};
  ACTIONS.forEach((action) => {
    map[action.id] = overrides[action.id] || getDefaultBinding(action.id);
  });
  return map;
}

function normalizeKey(key) {
  return key && key.length === 1 ? key.toUpperCase() : key;
}

function bindingsEqual(a, b) {
  if (!a || !b) return false;
  return !!a.meta === !!b.meta && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift &&
    normalizeKey(a.key) === normalizeKey(b.key);
}

// Matches a resolved binding against a live DOM KeyboardEvent (renderer only).
function matchesEvent(binding, event) {
  if (!binding || !binding.key) return false;
  if (!!event.metaKey !== !!binding.meta) return false;
  if (!!event.ctrlKey !== !!binding.ctrl) return false;
  if (!!event.altKey !== !!binding.alt) return false;
  if (!!event.shiftKey !== !!binding.shift) return false;

  const eventKey = event.key === ' ' ? 'Space' : event.key;
  return normalizeKey(eventKey) === normalizeKey(binding.key);
}

// Builds an Electron Accelerator string for global-scope bindings.
function toAccelerator(binding) {
  if (!binding || !binding.key) return null;
  const parts = [];
  if (binding.meta) parts.push(isMac ? 'Cmd' : 'Super');
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join('+');
}

function isModifierKey(key) {
  return key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift';
}

// Captures a binding from a live "press a key to record" keydown event.
// Returns null if the key isn't in the allowed whitelist.
function captureFromEvent(event) {
  const rawKey = event.key === ' ' ? 'Space' : event.key;
  const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
  if (!ALLOWED_KEYS.has(key)) return null;

  return {
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key
  };
}

// Human-readable label for displaying a binding, e.g. "⌘⇧X" / "Ctrl+Shift+X".
function formatBinding(binding) {
  if (!binding || !binding.key) return '';
  const keyLabel = binding.key === 'Space' ? 'Space' : binding.key;

  if (isMac) {
    let s = '';
    if (binding.ctrl) s += '⌃';
    if (binding.alt) s += '⌥';
    if (binding.shift) s += '⇧';
    if (binding.meta) s += '⌘';
    return s + keyLabel;
  }

  const parts = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push('Win');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(keyLabel);
  return parts.join('+');
}

module.exports = {
  ACTIONS,
  ALLOWED_KEYS,
  getAction,
  getDefaultBinding,
  resolveBindings,
  matchesEvent,
  toAccelerator,
  captureFromEvent,
  isModifierKey,
  formatBinding,
  bindingsEqual
};

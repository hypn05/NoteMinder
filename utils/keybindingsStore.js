// Renderer-side in-memory cache of the effective keybindings, backed by the
// main process's keybindings.json via IPC. A single instance of this module
// is shared by renderer.js and editor.js (same renderer process, same
// require() cache), so both always see the same live bindings without
// needing an async round-trip on every keydown.

const { ipcRenderer } = require('electron');
const {
  ACTIONS,
  resolveBindings,
  matchesEvent,
  captureFromEvent,
  isModifierKey,
  formatBinding,
  bindingsEqual,
  getDefaultBinding
} = require('./keybindings');

let overrides = {};
let effective = resolveBindings(overrides);

async function load() {
  overrides = (await ipcRenderer.invoke('get-keybindings')) || {};
  effective = resolveBindings(overrides);
}

function matches(actionId, event) {
  return matchesEvent(effective[actionId], event);
}

function getBinding(actionId) {
  return effective[actionId];
}

function getAllForUI() {
  const groups = {};
  ACTIONS.forEach((action) => {
    if (!groups[action.group]) groups[action.group] = [];
    groups[action.group].push({
      id: action.id,
      label: action.label,
      scope: action.scope,
      binding: effective[action.id],
      display: formatBinding(effective[action.id]),
      isCustom: !bindingsEqual(effective[action.id], getDefaultBinding(action.id))
    });
  });
  return groups;
}

// Returns the id of another action already using `binding`, or null.
function findConflict(actionId, binding) {
  const clash = ACTIONS.find((a) => a.id !== actionId && bindingsEqual(effective[a.id], binding));
  return clash ? clash.id : null;
}

async function setBinding(actionId, binding) {
  const conflict = findConflict(actionId, binding);
  if (conflict) {
    const conflictAction = ACTIONS.find((a) => a.id === conflict);
    return { success: false, error: `Already used by "${conflictAction.label}"` };
  }

  overrides[actionId] = binding;
  effective[actionId] = binding;
  const result = await ipcRenderer.invoke('save-keybinding', { actionId, binding });
  return result || { success: true };
}

async function resetBinding(actionId) {
  delete overrides[actionId];
  effective[actionId] = getDefaultBinding(actionId);
  await ipcRenderer.invoke('reset-keybinding', actionId);
}

async function resetAll() {
  overrides = {};
  effective = resolveBindings(overrides);
  await ipcRenderer.invoke('reset-keybindings');
}

module.exports = {
  load,
  matches,
  getBinding,
  getAllForUI,
  setBinding,
  resetBinding,
  resetAll,
  captureFromEvent,
  isModifierKey,
  formatBinding
};

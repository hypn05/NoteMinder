// Secure clipboard helper for secrets (passwords, usernames).
// Standard password-vault behavior: after a timeout, clear the OS clipboard
// — but only if it still holds the secret, so we never clobber something the
// user copied afterwards. Renderer-side (uses Electron's clipboard module,
// available because nodeIntegration is on).
const { clipboard } = require('electron');

const DEFAULT_CLEAR_AFTER_MS = 30 * 1000;

// Track one pending clear per app window so copying secret B cancels the
// pending clear for secret A (otherwise A's timer would wipe B early).
let pendingClear = null;

async function copySecret(text, clearAfterMs = DEFAULT_CLEAR_AFTER_MS) {
  clipboard.writeText(text);

  if (pendingClear) {
    clearTimeout(pendingClear);
    pendingClear = null;
  }

  pendingClear = setTimeout(() => {
    pendingClear = null;
    // Only clear if the clipboard still holds exactly this secret.
    if (clipboard.readText() === text) {
      clipboard.clear();
    }
  }, clearAfterMs);
}

module.exports = { copySecret, DEFAULT_CLEAR_AFTER_MS };

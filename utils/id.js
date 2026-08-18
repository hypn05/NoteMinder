// Collision-resistant ID generation, shared by both processes.
// Replaces Date.now().toString(), which collides when several entities are
// created inside the same millisecond (bulk imports, template expansion).
const { randomUUID } = require('crypto');

function newId() {
  // randomUUID is available on all supported Node/Electron versions; the
  // fallback keeps the old shape with added randomness just in case.
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { newId };

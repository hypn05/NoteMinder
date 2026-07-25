// Note templates offered by the ":t" search command. Shared between the
// search window (to list them) and the main window (to build the actual
// note) — both are renderer processes with node integration, so both can
// require this directly.

// Matches the exact markup Editor.insertTaskList() produces, so a template's
// checklist items behave identically to ones created by hand (click to
// toggle, click-to-focus label, backspace-to-remove, etc.)
function taskItemHtml(label = '') {
  return `<div class="task-item" style="display:flex;align-items:center;margin-bottom:4px;"><input type="checkbox" style="margin-right:8px;"><span class="task-label" contenteditable="true">${label}</span></div>`;
}

const TEMPLATES = [
  {
    id: 'meeting-notes',
    label: 'Meeting Notes',
    icon: '🗒️',
    title: () => `Meeting Notes — ${new Date().toLocaleDateString()}`,
    content: () =>
      '<p><strong>Attendees:</strong> </p>' +
      '<h3>Agenda</h3><ul><li></li></ul>' +
      '<h3>Notes</h3><p></p>' +
      '<h3>Action Items</h3>' + taskItemHtml()
  },
  {
    id: 'daily-log',
    label: 'Daily Log',
    icon: '📅',
    title: () => `Daily Log — ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`,
    content: () =>
      '<h3>Top Priorities</h3>' + taskItemHtml() + taskItemHtml() + taskItemHtml() +
      '<h3>Notes</h3><p></p>'
  }
];

function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

module.exports = { TEMPLATES, getTemplate };

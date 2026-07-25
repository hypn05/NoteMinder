// Converts a note's stored HTML (from the contenteditable editor) into the
// same Markdown syntax the editor's own auto-formatting understands (see the
// "Markdown shortcuts" section of the shortcuts panel) — so a note exported
// here and re-imported via "Import Markdown" round-trips cleanly.
// Renderer-only: relies on DOMParser/document, not available in the main process.

function inline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const children = Array.from(node.childNodes).map(inline).join('');
  const tag = node.tagName.toLowerCase();

  switch (tag) {
    case 'b':
    case 'strong':
      return children.trim() ? `**${children}**` : children;
    case 'i':
    case 'em':
      return children.trim() ? `*${children}*` : children;
    case 's':
    case 'strike':
    case 'del':
      return children.trim() ? `~~${children}~~` : children;
    case 'mark':
      return children.trim() ? `==${children}==` : children;
    case 'code':
      return children.trim() ? `\`${children}\`` : children;
    case 'u':
      // No native markdown syntax for underline — keep it as passthrough
      // inline HTML, which GitHub-flavored markdown (and most renderers) honor.
      return children.trim() ? `<u>${children}</u>` : children;
    case 'a': {
      const href = node.getAttribute('href') || '';
      return `[${children}](${href})`;
    }
    case 'br':
      return '  \n';
    case 'img': {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      return `![${alt}](${src})`;
    }
    default:
      return children;
  }
}

function blockToMarkdown(node, listContext) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    return text.trim() ? text : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    return `${'#'.repeat(level)} ${inline(node).trim()}`;
  }

  if (tag === 'blockquote') {
    return Array.from(node.childNodes)
      .map((child) => blockToMarkdown(child, listContext))
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join('\n');
  }

  if (tag === 'hr') {
    return '---';
  }

  if (tag === 'pre') {
    const code = node.textContent;
    return `\`\`\`\n${code}\n\`\`\``;
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(node.children).filter((c) => c.tagName === 'LI');
    return items
      .map((li, i) => {
        const marker = tag === 'ol' ? `${i + 1}.` : '-';
        return `${marker} ${inline(li).trim()}`;
      })
      .join('\n');
  }

  // Task list items: div.task-item containing a checkbox + span.task-label
  if (node.classList && node.classList.contains('task-item')) {
    const checkbox = node.querySelector('input[type="checkbox"]');
    const label = node.querySelector('.task-label');
    const checked = checkbox && checkbox.checked;
    return `- [${checked ? 'x' : ' '}] ${label ? inline(label).trim() : inline(node).trim()}`;
  }

  if (tag === 'div' || tag === 'p') {
    // A div can be a plain paragraph, or a wrapper around block children
    // (e.g. a run of task-items) — recurse block-wise if it holds block
    // children, otherwise treat its content as one inline paragraph.
    const hasBlockChildren = Array.from(node.children).some((c) =>
      /^(div|p|ul|ol|blockquote|pre|h[1-6]|hr)$/i.test(c.tagName) || c.classList.contains('task-item')
    );
    if (hasBlockChildren) {
      return Array.from(node.childNodes)
        .map((child) => blockToMarkdown(child, listContext))
        .filter((line) => line !== '')
        .join('\n');
    }
    return inline(node).trim();
  }

  return inline(node).trim();
}

function htmlToMarkdown(html) {
  const container = document.createElement('div');
  container.innerHTML = html || '';

  const blocks = Array.from(container.childNodes)
    .map((node) => blockToMarkdown(node))
    .filter((block) => block !== '');

  return blocks.join('\n\n');
}

// Filesystem-safe filename from a note title. The id suffix keeps filenames
// stable across re-exports (so sync tools see an update, not a new file) and
// guarantees uniqueness when two notes share a title.
function safeFilename(title, id) {
  const base = (title || '').trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  const suffix = String(id).slice(-6);
  return `${base || 'Untitled'} (${suffix}).md`;
}

// Converts every note to markdown and writes it to the user's configured
// export folder (see 'export-notes-to-folder' in main.js). Shared by the
// Settings "Export Now" button and the auto-export-after-save hook, so
// there's exactly one place that decides what an exported note looks like.
async function exportNotes(notes) {
  const { ipcRenderer } = require('electron');
  const files = notes.map((note) => ({
    filename: safeFilename(note.title, note.id),
    content: `# ${note.title || 'Untitled'}\n\n${htmlToMarkdown(note.content)}`
  }));
  return ipcRenderer.invoke('export-notes-to-folder', files);
}

module.exports = { htmlToMarkdown, safeFilename, exportNotes };

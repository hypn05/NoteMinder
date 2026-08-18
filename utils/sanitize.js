// HTML/text sanitization helpers. These exist because note content is
// rendered with innerHTML while nodeIntegration is enabled — any markup that
// reaches innerHTML must be treated as code execution. Pure JS except where
// noted; safe to require from any process.

// Escape text for safe insertion into innerHTML templates.
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// URLs allowed in hrefs: web links, mail links, and in-app anchors/relative
// paths. Everything else (javascript:, data:, vbscript:, file:, …) is dropped.
function sanitizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[#/]/.test(value)) return value;
  // Protocol-relative URLs inherit http(s) — safe.
  if (value.startsWith('//')) return value;
  return '';
}

module.exports = { escapeHtml, sanitizeUrl };

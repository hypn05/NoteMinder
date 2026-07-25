// Shared #tag extraction — used by the main window (sidebar tag filters,
// the main search box) and the search window ("tag:" search operator), so
// both windows agree on what counts as a tag.

// Pulls #tags out of a note's HTML content. Requires no space between # and
// the tag so it can't be confused with "# Heading" (which the editor
// converts to a real heading before this ever runs).
function extractTags(content) {
  const text = (content || '')
    .replace(/<[^>]*>/g, ' ')
    // Strip full URLs first — auto-linked URLs keep the raw URL as their
    // visible text (see Editor.autoLinkUrls), and a #fragment/#section in
    // one would otherwise be picked up as a note tag.
    .replace(/https?:\/\/\S+/g, ' ');
  const matches = text.match(/#([a-zA-Z0-9_-]+)/g) || [];
  return [...new Set(matches.map(t => t.slice(1).toLowerCase()))];
}

module.exports = { extractTags };

// Tiny fuzzy matcher for the search palette: subsequence matching with a
// score, so "wr" finds "Weekly Review". Pure JS, no dependencies, safe to
// require from any process.

// Returns a score > 0 when every character of `query` appears in `text` in
// order; 0 otherwise. Higher = better. Consecutive matches, matches at word
// boundaries, and earlier matches all score higher.
function fuzzyScore(query, text) {
  if (!query) return 0;
  query = query.toLowerCase();
  text = (text || '').toLowerCase();

  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  let firstMatch = -1;

  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    let found = -1;
    while (ti < text.length) {
      if (text[ti] === ch) { found = ti; ti++; break; }
      ti++;
    }
    if (found === -1) return 0; // character missing → no match

    if (firstMatch === -1) firstMatch = found;
    if (found === lastMatch + 1) score += 5;              // consecutive
    if (found === 0 || /[\s\-_/:]/.test(text[found - 1])) score += 4; // word start
    score += 1;
    lastMatch = found;
  }

  // Prefer compact matches (span of the match vs. length of the text).
  const span = lastMatch - firstMatch + 1;
  score += Math.max(0, 10 - Math.floor((span - query.length) / 4));
  return score;
}

module.exports = { fuzzyScore };

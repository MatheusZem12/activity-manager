/**
 * Parses the title typed by the user.
 *
 * Format:
 *   text title #tag1 #tag2
 *
 * - hashtags (#) are extracted as categories and removed from the title;
 * - whatever is left (with spaces collapsed) becomes the clean title.
 *
 * Note: this runs **on the title only**. The entry content never goes
 * through here — it is stored byte for byte, because it is what gets pasted.
 *
 * This file runs both in main (require) and in the renderer (script tag,
 * it becomes window.EntryParser) — hence the UMD wrapper.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EntryParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // À-ÿ allows accents (categories in other languages, e.g. Portuguese).
  const TAG_PATTERN = /#([a-zA-Z0-9_À-ÿ]+)/g;

  function parseTitle(input) {
    const raw = (input || '').trim();

    const tags = [];
    let match;
    while ((match = TAG_PATTERN.exec(raw)) !== null) {
      const tag = match[1].trim().toLowerCase();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    TAG_PATTERN.lastIndex = 0;

    const title = raw.replace(TAG_PATTERN, ' ').replace(/\s+/g, ' ').trim();

    return { title, tags };
  }

  return { parseTitle };
});

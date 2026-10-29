/**
 * Parses the text typed by the user.
 *
 * Format:
 *   activity text #tag1 #tag2 !30
 *
 * - hashtags (#) are extracted as categories;
 * - !N sets the alert time: !30 or !30m (minutes), !2h (hours),
 *   !1h30 (hours and minutes);
 * - whatever is left becomes the activity text.
 *
 * If no time is given, defaultReminderMinutes applies and
 * `explicitReminder` comes back false — whoever edits an activity uses it to
 * know whether to touch the alert or leave it as it is.
 *
 * This file runs both in main (require) and in the renderer (script tag,
 * it becomes window.ActivityParser) — hence the UMD wrapper.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ActivityParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const TAG_PATTERN = /#([a-zA-Z0-9_À-ÿ]+)/g;
  // !2h, !1h30, !1h30m, !45m, !45 — the form with hours comes first in the alternation.
  const TIME_PATTERN = /!(?:(\d+)h(?:(\d{1,2})m?)?|(\d+)m?)/i;

  function parse(input, defaultReminderMinutes = 15) {
    const raw = (input || '').trim();

    const tags = [];
    let text = raw;

    let match;
    while ((match = TAG_PATTERN.exec(raw)) !== null) {
      const tag = match[1].trim().toLowerCase();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    TAG_PATTERN.lastIndex = 0;
    text = text.replace(TAG_PATTERN, ' ');

    let reminderMinutes = null;
    const timeMatch = text.match(TIME_PATTERN);
    if (timeMatch) {
      if (timeMatch[1] !== undefined) {
        reminderMinutes = parseInt(timeMatch[1], 10) * 60 + (parseInt(timeMatch[2], 10) || 0);
      } else {
        reminderMinutes = parseInt(timeMatch[3], 10);
      }
      text = text.replace(TIME_PATTERN, ' ');
    }

    text = text.replace(/\s+/g, ' ').trim();

    const explicitReminder = reminderMinutes !== null && reminderMinutes > 0;
    const minutes = Math.max(1, explicitReminder ? reminderMinutes : defaultReminderMinutes);

    return {
      text,
      tags,
      reminderMinutes: minutes,
      explicitReminder,
      dueAt: Date.now() + minutes * 60 * 1000
    };
  }

  return { parse };
});

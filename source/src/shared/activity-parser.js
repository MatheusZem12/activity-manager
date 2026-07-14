/**
 * Interpreta o texto digitado pelo usuário.
 *
 * Formato:
 *   texto da atividade #tag1 #tag2 !30
 *
 * - hashtags (#) são extraídas como categorias;
 * - !N define o tempo do alerta: !30 ou !30m (minutos), !2h (horas),
 *   !1h30 (horas e minutos);
 * - tudo que sobrar vira o texto da atividade.
 *
 * Se o tempo não for informado, usa defaultReminderMinutes e
 * `explicitReminder` volta false — quem edita uma atividade usa isso para
 * saber se deve mexer no alerta ou deixá-lo como está.
 *
 * Este arquivo roda tanto no main (require) quanto no renderer (script tag,
 * vira window.ActivityParser) — por isso o invólucro UMD.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ActivityParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const TAG_PATTERN = /#([a-zA-Z0-9_À-ÿ]+)/g;
  // !2h, !1h30, !1h30m, !45m, !45 — a forma com horas vem primeiro na alternação.
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

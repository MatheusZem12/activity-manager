/**
 * Interpreta o título digitado pelo usuário.
 *
 * Formato:
 *   título do texto #tag1 #tag2
 *
 * - hashtags (#) são extraídas como categorias e removidas do título;
 * - tudo que sobrar (com espaços colapsados) vira o título limpo.
 *
 * Atenção: isto roda **apenas sobre o título**. O conteúdo da entrada nunca
 * passa por aqui — ele é armazenado byte a byte, porque é o que será colado.
 *
 * Este arquivo roda tanto no main (require) quanto no renderer (script tag,
 * vira window.EntryParser) — por isso o invólucro UMD.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EntryParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // O À-ÿ permite acentos (categorias em português).
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

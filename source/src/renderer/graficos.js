/**
 * Gráficos em HTML, não em SVG.
 *
 * A primeira versão era SVG com `viewBox="0 0 100 h"` e
 * `preserveAspectRatio="none"`, para as barras acompanharem a largura. Isso
 * estica o eixo X em ~9× — e o texto junto: os rótulos saíram achatados e
 * ilegíveis, e as barras nem apareceram, porque `width: calc(...)` num `rect`
 * dentro de viewBox escalado não significa o que parece.
 *
 * Barra é um retângulo com largura percentual. `div` faz isso nativamente, o
 * texto renderiza no tamanho certo, e o hover vem de graça. SVG só se paga
 * quando há curva, eixo contínuo ou recorte — nada disso aqui.
 *
 * As duas regras que valem mais que estética:
 *
 *   cor segue a ENTIDADE, nunca a posição. Filtrar não pode repintar quem
 *   sobrou — a cor de "estudo" é a mesma sempre, e vem do servidor com o nome.
 *
 *   texto usa cor de texto, nunca a da série. O valor ao lado de uma barra azul
 *   é cinza; quem carrega identidade é a barra.
 */

const Graficos = (() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

  function duracao(segundos) {
    if (!segundos) return '0min';
    const h = Math.floor(segundos / 3600);
    const m = Math.round((segundos % 3600) / 60);
    if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
    if (h) return `${h}h`;
    return `${Math.max(1, m)}min`;
  }

  /**
   * Barras horizontais.
   *
   * Horizontal e não vertical porque os rótulos são nomes: "ArquiteturaSoftwareEEP"
   * na vertical vira texto girado ou cortado, e nenhum dos dois se lê.
   *
   * A escala é relativa ao maior item, não ao total: a pergunta é "qual pesa
   * mais", e contra o total tudo vira um traço quando há muitas linhas.
   */
  function barras(itens, { corPadrao = '#64748b', vazio = 'Nada aqui ainda.', limite = 8 } = {}) {
    if (!itens || !itens.length) return `<p class="g-vazio">${esc(vazio)}</p>`;

    const visiveis = itens.slice(0, limite);
    const resto = itens.slice(limite);
    const maior = Math.max(...visiveis.map((i) => i.segundos), 1);

    const linhas = visiveis.map((item) => {
      // Piso de 2%: um valor pequeno mas real precisa aparecer, senão parece
      // que a linha não tem dado nenhum.
      const pct = Math.max(2, (item.segundos / maior) * 100);
      return `
        <div class="g-linha" title="${esc(item.nome)} — ${duracao(item.segundos)}">
          <span class="g-rotulo">${esc(item.nome)}</span>
          <span class="g-trilho">
            <span class="g-barra" style="width:${pct}%;background:${esc(item.cor || corPadrao)}"></span>
          </span>
          <span class="g-valor">${duracao(item.segundos)}</span>
        </div>`;
    }).join('');

    // Truncar em silêncio faria a soma das barras não bater com o total do
    // cartão, e quem olhasse não saberia por quê.
    const nota = resto.length
      ? `<p class="g-nota">+ ${resto.length} com menos tempo · ${duracao(resto.reduce((s, i) => s + i.segundos, 0))}</p>`
      : '';

    return `<div class="g-barras">${linhas}</div>${nota}`;
  }

  /**
   * Colunas empilhadas, uma por dia.
   *
   * Empilhada e não uma linha por categoria: a pergunta é "como o dia se
   * dividiu", e a altura total — quanto tempo a máquina foi usada — é
   * informação junto. Cinco linhas cruzadas dariam a proporção e perderiam isso.
   */
  function empilhado(dias, categorias) {
    if (!dias || !dias.length) return '<p class="g-vazio">Sem dados no período.</p>';

    const totalDe = (d) =>
      Object.values(d.categorias).reduce((s, v) => s + v, 0) + (d.naoClassificado || 0);
    const teto = Math.max(...dias.map(totalDe), 1);

    const colunas = dias.map((dia) => {
      const total = totalDe(dia);
      const pedacos = categorias
        .filter((c) => dia.categorias[c.chave])
        .map((c) => {
          const v = dia.categorias[c.chave];
          return `<span class="g-fatia" style="height:${(v / teto) * 100}%;background:${esc(c.cor)}"
                        title="${esc(c.nome)} — ${duracao(v)}"></span>`;
        }).join('');

      const naoClass = dia.naoClassificado
        ? `<span class="g-fatia g-naoclass" style="height:${(dia.naoClassificado / teto) * 100}%"
                 title="Não classificado — ${duracao(dia.naoClassificado)}"></span>`
        : '';

      const data = new Date(`${dia.data}T12:00:00`);
      const dow = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][data.getDay()];

      return `
        <div class="g-coluna" title="${esc(dia.data)} — ${duracao(total)}">
          <div class="g-pilha">${naoClass}${pedacos}</div>
          <span class="g-dia">${dow}</span>
          <span class="g-num">${data.getDate()}</span>
        </div>`;
    }).join('');

    return `<div class="g-empilhado">${colunas}</div>`;
  }

  /**
   * Legenda. Sempre presente com duas ou mais séries — identidade nunca pode
   * depender só de cor.
   */
  function legenda(categorias) {
    if (!categorias || categorias.length < 2) return '';
    return `<div class="g-legenda">${categorias.map((c) => `
      <span class="g-item"><i style="background:${esc(c.cor)}"></i>${esc(c.nome)}</span>`).join('')}</div>`;
  }

  return { barras, empilhado, legenda, duracao };
})();

/**
 * A aba Rastro.
 *
 * Exibição, e só. Nenhuma conta é feita aqui: categoria, projeto, ociosidade e
 * totais vêm prontos do backend. A única exceção é a lista de "tempo por app",
 * que o processo principal soma do arquivo local para a tela não ficar vazia
 * antes de haver servidor configurado.
 */

/* global RastroAPI */

const Rastro = (() => {
  let estado = null;
  let relatorio = null;
  let local = null;
  let categorias = [];
  let regras = [];
  let subAba = 'hoje';
  let erro = null;
  let ocupado = false;

  const SUB_ABAS = [
    { chave: 'hoje', rotulo: 'Hoje' },
    { chave: 'categorias', rotulo: 'Categorias' },
    { chave: 'regras', rotulo: 'Regras' },
    { chave: 'conta', rotulo: 'Conta' }
  ];

  function duracao(segundos) {
    if (!segundos) return '0min';
    const h = Math.floor(segundos / 3600);
    const m = Math.round((segundos % 3600) / 60);
    if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
    if (h) return `${h}h`;
    return `${Math.max(1, m)}min`;
  }

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function limitesDoDia() {
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const fim = new Date(); fim.setHours(24, 0, 0, 0);
    return { de: inicio.toISOString(), ate: fim.toISOString() };
  }

  async function carregar() {
    erro = null;
    estado = await RastroAPI.estado();
    local = await RastroAPI.local();
    if (estado.temToken && estado.servidor) {
      try {
        const { de, ate } = limitesDoDia();
        relatorio = await RastroAPI.relatorio(de, ate);
        categorias = (await RastroAPI.categorias()).categorias || [];
        regras = (await RastroAPI.regras()).regras || [];
      } catch (e) {
        erro = e.message;
        relatorio = null;
      }
    } else {
      relatorio = null;
    }
  }

  // ------------------------------------------------------------------ barras

  function barras(itens, total, corDe) {
    if (!itens || !itens.length) return '<p class="empty-hint">Nada aqui ainda.</p>';
    return `<div class="rastro-barras">${itens.map((i) => {
      const pct = total ? Math.round((i.segundos / total) * 100) : 0;
      return `
        <div class="rastro-barra">
          <div class="rastro-barra-topo">
            <span>${esc(i.nome)}</span>
            <span class="rastro-barra-valor">${duracao(i.segundos)}</span>
          </div>
          <div class="rastro-trilho">
            <div class="rastro-preenchimento" style="width:${pct}%;background:${corDe(i)}"></div>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // -------------------------------------------------------------------- hoje

  function telaHoje() {
    if (!relatorio) {
      const total = local ? local.segundos : 0;
      return `
        <div class="rastro-aviso">
          <strong>Só local.</strong> Sem servidor configurado, o Rastro grava mas não
          classifica — categoria, projeto e ociosidade são decididos no backend.
          Configure em <b>Conta</b>.
        </div>
        <h3 class="rastro-titulo">Tempo por aplicativo — hoje</h3>
        <p class="rastro-resumo">${local ? local.segmentos : 0} segmentos · ${duracao(total)}</p>
        ${barras(local ? local.apps : [], total, () => 'var(--accent, #4C8DFF)')}`;
    }

    const totalCat = relatorio.categorias.reduce((s, c) => s + c.segundos, 0);
    const totalProj = relatorio.projetos.reduce((s, p) => s + p.segundos, 0);
    const totalApp = relatorio.apps.reduce((s, a) => s + a.segundos, 0);

    return `
      <div class="rastro-cartoes">
        <div class="rastro-cartao"><span>Registrado</span><strong>${duracao(totalCat)}</strong></div>
        <div class="rastro-cartao"><span>Ocioso</span><strong>${duracao(relatorio.ociosoSegundos)}</strong></div>
        <div class="rastro-cartao ${relatorio.naoClassificadoSegundos ? 'alerta' : ''}">
          <span>Não classificado</span><strong>${duracao(relatorio.naoClassificadoSegundos)}</strong>
        </div>
      </div>

      <h3 class="rastro-titulo">Por categoria</h3>
      ${barras(relatorio.categorias.map((c) => ({ nome: c.nome, segundos: c.segundos, cor: c.cor })),
               totalCat, (i) => i.cor)}

      <h3 class="rastro-titulo">Por projeto</h3>
      ${barras(relatorio.projetos, totalProj, () => 'var(--accent, #4C8DFF)')}

      <h3 class="rastro-titulo">Por aplicativo</h3>
      ${barras(relatorio.apps, totalApp, () => '#888')}`;
  }

  // -------------------------------------------------------------- categorias

  function telaCategorias() {
    if (!estado.temToken) return semServidor();
    return `
      <p class="rastro-resumo">
        A <b>descrição</b> é o que entra no prompt do modelo — é ela que faz a
        classificação seguir a sua ideia de "estudo", e não a dele. Mudar
        qualquer coisa aqui invalida o que já foi classificado.
      </p>
      ${categorias.map((c) => `
        <div class="rastro-item" data-cat="${c.id}">
          <div class="rastro-item-topo">
            <span class="rastro-cor" style="background:${esc(c.cor)}"></span>
            <input class="rastro-nome" data-campo="nome" value="${esc(c.nome)}">
            <code class="rastro-chave">${esc(c.chave)}</code>
          </div>
          <textarea class="rastro-descricao" data-campo="descricao"
                    rows="2" placeholder="Descreva para o modelo o que cai aqui…">${esc(c.descricao)}</textarea>
          <button class="rastro-salvar" data-cat-salvar="${c.id}">Salvar</button>
        </div>`).join('')}`;
  }

  // ------------------------------------------------------------------ regras

  function telaRegras() {
    if (!estado.temToken) return semServidor();
    const opcoes = categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    return `
      <p class="rastro-resumo">
        Regras rodam <b>antes</b> da IA: são de graça, determinísticas, e valem
        para trás — criar uma reclassifica o histórico inteiro.
      </p>

      <div class="rastro-nova-regra">
        <input id="regra-classe" placeholder="Classe da janela (ex.: code)">
        <input id="regra-titulo" placeholder="Trecho do título (regex, ex.: 202602|NOTURNO)">
        <select id="regra-categoria"><option value="">— categoria —</option>${opcoes}</select>
        <input id="regra-projeto" placeholder="Projeto (opcional)">
        <button id="regra-criar">Criar</button>
      </div>

      ${regras.length ? regras.map((r) => {
        const cat = categorias.find((c) => c.id === r.categoriaId);
        return `
          <div class="rastro-item">
            <div class="rastro-item-topo">
              <code>${esc(r.wmClass || '*')}</code>
              <code>${esc(r.tituloRegex || '*')}</code>
              <span>→ ${esc(cat ? cat.nome : '—')}${r.projeto ? ` · ${esc(r.projeto)}` : ''}</span>
              <button class="rastro-apagar" data-regra="${r.id}">&times;</button>
            </div>
          </div>`;
      }).join('') : '<p class="empty-hint">Nenhuma regra ainda.</p>'}`;
  }

  // ------------------------------------------------------------------- conta

  function semServidor() {
    return '<div class="rastro-aviso">Configure o servidor na aba <b>Conta</b>.</div>';
  }

  function telaConta() {
    const execs = estado.executores.length
      ? estado.executores.map((e) => `<code>${esc(e)}</code>`).join(' ')
      : '<i>nenhum detectado</i>';
    const modelos = estado.modelosOllama.map(
      (m) => `<option value="${esc(m)}" ${estado.modelo === m ? 'selected' : ''}>${esc(m)}</option>`).join('');

    return `
      <h3 class="rastro-titulo">Servidor</h3>
      <div class="rastro-form">
        <label>Endereço</label>
        <input id="conta-servidor" value="${esc(estado.servidor)}" placeholder="http://localhost:8090">
        <label>E-mail</label>
        <input id="conta-email" type="email" placeholder="voce@exemplo.com">
        <label>Senha</label>
        <input id="conta-senha" type="password">
        <label>Convite <span class="form-hint">só na primeira vez, para criar a conta</span></label>
        <input id="conta-convite">
        <button id="conta-entrar">${estado.temToken ? 'Entrar de novo' : 'Entrar'}</button>
        <div class="form-hint">
          O token fica só nesta máquina. Este dispositivo se identifica como
          <b>${esc(estado.dispositivo)}</b>.
        </div>
      </div>

      <h3 class="rastro-titulo">IA nesta máquina</h3>
      <div class="rastro-form">
        <div class="form-hint">Detectado aqui: ${execs}</div>
        <label>Executor preferido</label>
        <select id="conta-preferido">
          <option value="claudecode" ${estado.preferido === 'claudecode' ? 'selected' : ''}>Claude Code (sem chave, usa sua assinatura)</option>
          <option value="ollama" ${estado.preferido === 'ollama' ? 'selected' : ''}>Ollama (local, o título não sai da máquina)</option>
        </select>
        ${modelos ? `<label>Modelo do Ollama</label><select id="conta-modelo">${modelos}</select>` : ''}
        <button id="conta-salvar">Salvar</button>
        <div class="form-hint">
          Com uma chave de API configurada no servidor, ele faz a chamada sozinho
          e nada disto é usado.
        </div>
      </div>

      <h3 class="rastro-titulo">Sincronização</h3>
      <div class="rastro-form">
        <button id="conta-sync" ${estado.temToken ? '' : 'disabled'}>Sincronizar agora</button>
        <div class="form-hint">
          ${estado.ultimaSync ? `Última: ${new Date(estado.ultimaSync).toLocaleTimeString('pt-BR')}` : 'Automático a cada 5 minutos.'}
          ${estado.ultimoErro ? `<br><span class="rastro-erro">${esc(estado.ultimoErro)}</span>` : ''}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ render

  async function render(container, aoTerminar) {
    if (!estado) {
      container.innerHTML = '<p class="empty-hint">Carregando…</p>';
      await carregar();
    }

    const corpo = subAba === 'hoje' ? telaHoje()
      : subAba === 'categorias' ? telaCategorias()
      : subAba === 'regras' ? telaRegras()
      : telaConta();

    container.innerHTML = `
      <div class="rastro">
        <div class="settings-tabs">
          ${SUB_ABAS.map((a) => `<button data-sub="${a.chave}" class="${subAba === a.chave ? 'active' : ''}">${a.rotulo}</button>`).join('')}
        </div>
        <div class="rastro-estado">
          <span class="rastro-pisca ${estado.coletando ? 'ok' : 'off'}"></span>
          ${estado.coletando ? 'coletando' : 'coletor parado'}
          ${estado.sincronizando ? ' · sincronizando' : ' · só local'}
        </div>
        ${erro ? `<div class="rastro-aviso erro">${esc(erro)}</div>` : ''}
        <div class="rastro-corpo">${corpo}</div>
      </div>`;

    ligar(container, aoTerminar);
  }

  async function recarregar(container, aoTerminar) {
    if (ocupado) return;
    ocupado = true;
    try {
      await carregar();
      await render(container, aoTerminar);
    } finally {
      ocupado = false;
    }
  }

  function ligar(container, aoTerminar) {
    container.querySelectorAll('[data-sub]').forEach((b) => {
      b.addEventListener('click', () => { subAba = b.dataset.sub; render(container, aoTerminar); });
    });

    const clique = (id, fn) => {
      const el = container.querySelector(`#${id}`);
      if (el) el.addEventListener('click', fn);
    };
    const valor = (id) => {
      const el = container.querySelector(`#${id}`);
      return el ? el.value.trim() : '';
    };

    clique('conta-entrar', async () => {
      try {
        await RastroAPI.entrar({
          servidor: valor('conta-servidor'),
          email: valor('conta-email'),
          senha: valor('conta-senha'),
          convite: valor('conta-convite')
        });
        await recarregar(container, aoTerminar);
      } catch (e) { erro = e.message; render(container, aoTerminar); }
    });

    clique('conta-salvar', async () => {
      await RastroAPI.configurar({
        preferido: valor('conta-preferido') || 'claudecode',
        modelo: valor('conta-modelo') || null
      });
      await recarregar(container, aoTerminar);
    });

    clique('conta-sync', async () => {
      try {
        await RastroAPI.sincronizar();
        await recarregar(container, aoTerminar);
      } catch (e) { erro = e.message; render(container, aoTerminar); }
    });

    container.querySelectorAll('[data-cat-salvar]').forEach((b) => {
      b.addEventListener('click', async () => {
        const bloco = b.closest('[data-cat]');
        try {
          await RastroAPI.salvarCategoria(Number(bloco.dataset.cat), {
            nome: bloco.querySelector('[data-campo="nome"]').value,
            descricao: bloco.querySelector('[data-campo="descricao"]').value
          });
          await recarregar(container, aoTerminar);
        } catch (e) { erro = e.message; render(container, aoTerminar); }
      });
    });

    clique('regra-criar', async () => {
      try {
        await RastroAPI.salvarRegra(null, {
          wmClass: valor('regra-classe') || null,
          tituloRegex: valor('regra-titulo') || null,
          categoriaId: Number(valor('regra-categoria')) || null,
          projeto: valor('regra-projeto') || null
        });
        await recarregar(container, aoTerminar);
      } catch (e) { erro = e.message; render(container, aoTerminar); }
    });

    container.querySelectorAll('[data-regra]').forEach((b) => {
      b.addEventListener('click', async () => {
        await RastroAPI.apagarRegra(Number(b.dataset.regra));
        await recarregar(container, aoTerminar);
      });
    });
  }

  return { render, recarregar, invalidar() { estado = null; } };
})();

/**
 * A ligação do Rastro com o resto do app.
 *
 * Mantém o coletor rodando, guarda a configuração desta máquina e responde ao
 * renderer. **Nada aqui decide o que o seu tempo significa** — isso é do
 * backend. O que existe aqui é: ler o que o coletor gravou, empacotar HTTP, e
 * chamar o modelo local quando o servidor pedir.
 *
 * A única agregação feita localmente é a de "tempo por app", e ela existe só
 * para a tela não ficar vazia quando não há servidor configurado. Categoria,
 * projeto e ociosidade vêm sempre de lá.
 */
const { ipcMain } = require('electron');
const { Collector } = require('./collector');
const { Sync } = require('./sync');
const { capacidades, modelosDoOllama } = require('./executor');
const config = require('./config');
const servidor = require('./servidor');
const store = require('../storage/segment-store');

let collector = null;
let sync = null;
let ultimoErro = null;
let ultimaSync = null;
let avisar = () => {};
let aoEntrar = async () => {};

function hoje() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O que o coletor gravou hoje, somado por app. Só isto — o resto é do servidor. */
function porAppLocal(data) {
  const total = new Map();
  let segundos = 0;
  for (const s of store.readDay(data)) {
    segundos += s.seconds;
    const chave = s.wmClass || '—';
    total.set(chave, (total.get(chave) || 0) + s.seconds);
  }
  return {
    segmentos: store.readDay(data).length,
    segundos,
    apps: [...total.entries()]
      .map(([nome, seg]) => ({ nome, segundos: seg }))
      .sort((a, b) => b.segundos - a.segundos)
  };
}

async function estado() {
  const cfg = config.ler();
  return {
    coletando: Boolean(collector),
    sincronizando: Boolean(sync && sync.configurado()),
    servidor: servidor.endereco(),
    dispositivo: cfg.dispositivo,
    preferido: cfg.preferido,
    modelo: cfg.modelo,
    provedorIa: cfg.provedorIa || '',
    // A chave em si NUNCA volta para a tela: só se ela existe. Devolver o valor
    // seria expor um segredo num canal que não precisa dele.
    temChave: Boolean(cfg.chaveIa),
    modeloIa: cfg.modeloIa || '',
    temToken: Boolean(cfg.token),
    executores: await capacidades(),
    modelosOllama: await modelosDoOllama(),
    ultimaSync,
    ultimoErro,
    dias: store.listDays()
  };
}

/** Fala com o backend usando a configuração desta máquina. */
async function api(caminho, opcoes = {}) {
  const cfg = config.ler();
  const r = await fetch(`${servidor.endereco()}/api${caminho}`, {
    ...opcoes,
    headers: {
      'content-type': 'application/json',
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      ...(opcoes.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `${caminho} respondeu ${r.status}`);
  return corpo;
}

function reiniciarSync() {
  if (sync) sync.parar();
  sync = new Sync(config.ler());
  sync.aoErrar = (e) => { ultimoErro = e.message; avisar(); };
  sync.iniciar();
}

function registrar({ aoMudar, aoEntrarNaConta } = {}) {
  avisar = aoMudar || (() => {});
  aoEntrar = aoEntrarNaConta || (async () => {});

  ipcMain.handle('rastro:estado', () => estado());

  ipcMain.handle('rastro:local', (_e, data) => porAppLocal(data || hoje()));

  /**
   * O relatório vem do servidor porque é lá que categoria, projeto e ociosidade
   * existem. Sem servidor, a tela mostra o que dá para saber sozinha.
   */
  ipcMain.handle('rastro:relatorio', async (_e, { de, ate }) => {
    const q = new URLSearchParams({ de, ate });
    return api(`/relatorio?${q}`);
  });

  ipcMain.handle('rastro:categorias', () => api('/categorias'));
  ipcMain.handle('rastro:regras', () => api('/regras'));

  ipcMain.handle('rastro:salvarCategoria', (_e, { id, dados }) =>
    api(id ? `/categorias/${id}` : '/categorias',
        { method: id ? 'PATCH' : 'POST', body: JSON.stringify(dados) }));

  ipcMain.handle('rastro:salvarRegra', (_e, { id, dados }) =>
    api(id ? `/regras/${id}` : '/regras',
        { method: id ? 'PATCH' : 'POST', body: JSON.stringify(dados) }));

  ipcMain.handle('rastro:apagarRegra', (_e, id) =>
    api(`/regras/${id}`, { method: 'DELETE' }));

  /** Entrar: o token fica só nesta máquina, nunca sai daqui. */
  ipcMain.handle('rastro:entrar', async (_e, { email, senha, convite }) => {
    const r = await api('/sessao', {
      method: 'POST',
      body: JSON.stringify({ email, senha, convite })
    });
    config.gravar({ token: r.token });
    reiniciarSync();
    // Entrar é o gatilho de puxar atividades e textos — e, na primeira vez,
    // de migrar os JSON antigos para o banco.
    await aoEntrar();
    return { email: r.email };
  });

  /** Sair: apaga só o token. Os segmentos já gravados continuam no disco. */
  ipcMain.handle('rastro:sair', () => {
    config.gravar({ token: '' });
    reiniciarSync();
    return { ok: true };
  });

  ipcMain.handle('rastro:configurar', (_e, patch) => {
    const novo = config.gravar(patch);
    reiniciarSync();
    return novo;
  });

  /** Força um ciclo agora, em vez de esperar os cinco minutos. */
  ipcMain.handle('rastro:sincronizar', async () => {
    if (!sync || !sync.configurado()) throw new Error('Sem servidor configurado.');
    ultimoErro = null;
    await sync.ciclo();
    if (ultimoErro) throw new Error(ultimoErro);
    ultimaSync = Date.now();
    return { ultimaSync };
  });
}

async function iniciar() {
  collector = new Collector();
  // O coletor não pode derrubar o app: fora do Hyprland ele simplesmente não
  // existe, e as outras duas abas continuam funcionando normalmente.
  try {
    await collector.start();
  } catch (e) {
    ultimoErro = e.message;
    collector = null;
  }
  reiniciarSync();
}

function parar() {
  if (collector) collector.stop();
  if (sync) sync.parar();
  collector = null;
}

module.exports = { registrar, iniciar, parar };

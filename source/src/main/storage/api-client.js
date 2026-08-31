/**
 * O cliente HTTP do app. Fino de propósito.
 *
 * Nada aqui decide nada: só empacota pedido e desembrulha resposta. Endereço e
 * token vêm da configuração desta máquina (`rastro/config.js`), que nunca sobe
 * para o servidor.
 */
const config = require('../rastro/config');

class SemSessao extends Error {
  constructor() {
    super('Sem sessão. Abra o painel em Rastro → Conta e entre no servidor.');
    this.semSessao = true;
  }
}

function configurado() {
  const c = config.ler();
  return Boolean(c.servidor && c.token);
}

async function pedir(caminho, { metodo = 'GET', corpo, tempoLimite = 30000 } = {}) {
  const c = config.ler();
  if (!c.servidor || !c.token) throw new SemSessao();

  const r = await fetch(`${c.servidor}/api${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(tempoLimite)
  });

  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : {};
  if (!r.ok) {
    // 401 quer dizer token vencido, e a mensagem tem que dizer o que fazer —
    // "respondeu 401" não ajuda ninguém a resolver.
    if (r.status === 401) throw new SemSessao();
    throw new Error(dados.erro || `${caminho} respondeu ${r.status}`);
  }
  return dados;
}

module.exports = { pedir, configurado, SemSessao };

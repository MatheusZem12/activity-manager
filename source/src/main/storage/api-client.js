/**
 * O cliente HTTP do app. Fino de propósito.
 *
 * Nada aqui decide nada: só empacota pedido e desembrulha resposta. O endereço
 * é constante (`rastro/servidor.js`); o token é desta máquina e nunca sobe.
 */
const config = require('../rastro/config');
const servidor = require('../rastro/servidor');

class SemSessao extends Error {
  constructor() {
    super('Sem sessão. Entre na sua conta para continuar.');
    this.semSessao = true;
  }
}

function configurado() {
  return Boolean(config.ler().token);
}

async function pedir(caminho, { metodo = 'GET', corpo, tempoLimite = 30000 } = {}) {
  const c = config.ler();
  if (!c.token) throw new SemSessao();

  const r = await fetch(`${servidor.endereco()}/api${caminho}`, {
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

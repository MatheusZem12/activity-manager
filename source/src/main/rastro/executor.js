/**
 * O executor local de IA.
 *
 * Ele não decide nada. Recebe um prompt pronto e um schema pronto do servidor,
 * roda no modelo que ESTA máquina tem, e devolve o JSON. Quem escolheu o que
 * perguntar, montou o formato da resposta e vai validar o que voltar é o
 * backend — aqui é só o driver.
 *
 * Existe porque a VPS não alcança o `ollama` nem o `claude` da sua máquina. Com
 * uma chave de API configurada no servidor, nada disto roda: o backend chama o
 * modelo sozinho e o dispositivo nunca vê uma tarefa.
 */
const { execFile } = require('child_process');

const OLLAMA = process.env.RASTRO_OLLAMA || 'http://127.0.0.1:11434';

function rodar(cmd, args, entrada = null, tempoLimite = 180000) {
  return new Promise((resolve, reject) => {
    const filho = execFile(cmd, args, { timeout: tempoLimite, maxBuffer: 8 * 1024 * 1024 },
      (erro, saida) => (erro ? reject(erro) : resolve(String(saida))));
    if (entrada !== null) {
      filho.stdin.write(entrada);
      filho.stdin.end();
    }
  });
}

function existe(cmd) {
  return rodar('which', [cmd], null, 3000).then(() => true).catch(() => false);
}

/**
 * O que esta máquina consegue rodar.
 *
 * Não é segredo, é capacidade — e é isso que sobe para o servidor junto com os
 * segmentos, para ele saber a quem pode entregar uma tarefa.
 */
async function capacidades() {
  const lista = [];
  if (await existe('claude')) lista.push('claudecode');
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const { models } = await r.json();
      if (models && models.length) lista.push('ollama');
    }
  } catch { /* ollama desligado: só não anuncia */ }
  return lista;
}

async function modelosDoOllama() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return [];
    const { models } = await r.json();
    return (models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * O `format` do Ollama recebe o JSON Schema direto — sem adaptador, sem
 * conversão. É o que torna o modelo local a integração mais simples das cinco.
 */
async function viaOllama(prompt, esquema, modelo) {
  const escolhido = modelo || (await modelosDoOllama())[0];
  if (!escolhido) throw new Error('nenhum modelo baixado no ollama');

  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: escolhido,
      stream: false,
      format: JSON.parse(esquema),
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(300000)
  });
  if (!r.ok) throw new Error(`ollama respondeu ${r.status}`);
  const { message } = await r.json();
  return lerJson(message.content);
}

/**
 * O Claude Code usa a assinatura de quem está logado na máquina: sem chave,
 * sem custo por token. É o padrão do desktop justamente por isso.
 */
async function viaClaudeCode(prompt, esquema) {
  const pedido = `${prompt}\n\nResponda SOMENTE com JSON válido neste formato, sem cerca de markdown:\n${esquema}`;
  const saida = await rodar('claude', ['-p', '--output-format', 'text'], pedido);
  return lerJson(saida);
}

/** O modelo às vezes embrulha em cerca de markdown mesmo com schema fechado. */
function lerJson(texto) {
  let limpo = (texto || '').trim();
  if (limpo.startsWith('```')) {
    limpo = limpo.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(limpo);
}

/**
 * Roda a tarefa no melhor executor disponível.
 *
 * Claude Code primeiro: é mais capaz e não custa token extra. O ollama entra
 * quando ele não existe — ou quando o usuário preferir que o título nem chegue
 * a sair da máquina.
 */
async function executar({ prompt, esquema, preferido, modelo }) {
  const disponiveis = await capacidades();
  const ordem = preferido && disponiveis.includes(preferido)
    ? [preferido, ...disponiveis.filter((e) => e !== preferido)]
    : disponiveis;

  let ultimoErro = null;
  for (const executor of ordem) {
    try {
      if (executor === 'claudecode') return await viaClaudeCode(prompt, esquema);
      if (executor === 'ollama') return await viaOllama(prompt, esquema, modelo);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro || new Error('nenhum executor de IA disponível nesta máquina');
}

module.exports = { executar, capacidades, modelosDoOllama };

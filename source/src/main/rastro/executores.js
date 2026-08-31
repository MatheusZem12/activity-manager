/**
 * O que ESTA máquina consegue rodar de IA — e como rodar.
 *
 * O servidor monta o prompt e o schema, porque isso é regra de negócio. O que
 * ele não alcança é o Ollama e o `claude` que vivem aqui. Então este arquivo é
 * um executor: recebe texto e formato prontos, devolve JSON, e não sabe o que
 * está classificando nem por quê.
 *
 * Nada de segredo mora aqui. Chave de API, quando existe, fica no servidor —
 * porque quando existe é o servidor que faz a chamada e nem passa por aqui.
 */
const { execFile } = require('child_process');

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';

function rodar(cmd, args, { timeout = 300000, entrada } = {}) {
  return new Promise((resolve, reject) => {
    const filho = execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024 },
      (erro, stdout) => (erro ? reject(erro) : resolve(String(stdout))));
    if (entrada !== undefined) {
      filho.stdin.write(entrada);
      filho.stdin.end();
    }
  });
}

/** O `claude` da máquina, usando a assinatura de quem está logado. Sem chave. */
async function claudeCodeDisponivel() {
  try {
    await rodar('claude', ['--version'], { timeout: 5000 });
    return true;
  } catch { return false; }
}

async function modelosDoOllama() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const dados = await r.json();
    return (dados.models || []).map((m) => m.name);
  } catch { return []; }
}

/**
 * O que anunciar ao servidor. Não é segredo, é capacidade: é assim que ele sabe
 * a quem pode entregar uma tarefa que só roda numa máquina local.
 */
async function detectar() {
  const [claude, modelos] = await Promise.all([claudeCodeDisponivel(), modelosDoOllama()]);
  const executores = [];
  if (claude) executores.push('claudecode');
  if (modelos.length) executores.push('ollama');
  return { executores, modelos };
}

// ------------------------------------------------------------------ executar

async function viaOllama(prompt, esquema, modelo) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      stream: false,
      // O Ollama aceita JSON Schema direto neste campo. É o que garante que o
      // modelo devolva as categorias do usuário e não invente uma sexta.
      format: JSON.parse(esquema),
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) throw new Error(`ollama respondeu ${r.status}`);
  const dados = await r.json();
  return lerJson(dados.message && dados.message.content);
}

async function viaClaudeCode(prompt, esquema) {
  // O CLI não tem saída estruturada, então o formato vai no próprio pedido. Por
  // isso a resposta ainda passa por `lerJson`: cerca de markdown acontece.
  const pedido = `${prompt}\n\nResponda APENAS com JSON válido neste formato:\n${esquema}`;
  const saida = await rodar('claude', ['-p', '--output-format', 'text'], { entrada: pedido });
  return lerJson(saida);
}

/**
 * O modelo às vezes embrulha o JSON em cerca de markdown mesmo com formato
 * fechado. Recortar aqui é mais barato do que perder o lote inteiro.
 */
function lerJson(texto) {
  let limpo = (texto || '').trim();
  if (limpo.startsWith('```')) {
    limpo = limpo.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(limpo);
}

/**
 * Executa uma tarefa do servidor com o provedor local escolhido.
 *
 * @param {object} tarefa    `{ prompt, esquema }`, como veio do backend
 * @param {object} preferido `{ provedor: 'ollama'|'claudecode', modelo }`
 */
async function executar(tarefa, preferido) {
  if (preferido.provedor === 'claudecode') return viaClaudeCode(tarefa.prompt, tarefa.esquema);
  if (preferido.provedor === 'ollama') return viaOllama(tarefa.prompt, tarefa.esquema, preferido.modelo);
  throw new Error(`provedor local desconhecido: ${preferido.provedor}`);
}

module.exports = { detectar, executar, modelosDoOllama, claudeCodeDisponivel };

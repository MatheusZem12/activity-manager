/**
 * O executor local de IA.
 *
 * Ele não decide nada. Recebe um prompt pronto e um schema pronto do servidor,
 * roda no modelo que ESTA máquina tem, e devolve o JSON. Quem escolheu o que
 * perguntar, montou o formato da resposta e vai validar o que voltar é o
 * backend — aqui é só o driver.
 *
 * Existe porque **o servidor não fala com modelo nenhum**. Ele monta a pergunta
 * e enfileira; quem executa é sempre uma máquina do usuário, com o que ela
 * tiver: o `claude` logado, um modelo no ollama, ou uma chave de API guardada
 * localmente.
 *
 * A chave nunca sobe. Chave num servidor compartilhado é uma credencial a mais
 * para vazar, para rotacionar e para pagar sem saber por quem.
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

// --------------------------------------------------------- chaves de API
//
// Os três falam JSON estruturado, cada um com o seu nome para a mesma ideia.
// O Gemini é o que mais destoa: `responseSchema` é um subconjunto do OpenAPI e
// não aceita `additionalProperties`, então o schema é podado antes de ir.

async function viaAnthropic(prompt, esquema, chave, modelo) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelo || 'claude-haiku-4-5',
      max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: JSON.parse(esquema) } },
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error(`anthropic respondeu ${r.status}`);
  const corpo = await r.json();
  const bloco = (corpo.content || []).find((b) => b.type === 'text');
  if (!bloco) throw new Error('anthropic respondeu sem conteúdo');
  return lerJson(bloco.text);
}

async function viaOpenai(prompt, esquema, chave, modelo) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'classificacao', strict: true, schema: JSON.parse(esquema) }
      }
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error(`openai respondeu ${r.status}`);
  const corpo = await r.json();
  return lerJson(corpo.choices?.[0]?.message?.content);
}

/** O Gemini recusa `additionalProperties`; podar é mais barato que outro schema. */
function podarParaGemini(no) {
  if (Array.isArray(no)) return no.map(podarParaGemini);
  if (no && typeof no === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(no)) {
      if (k === 'additionalProperties') continue;
      saida[k] = podarParaGemini(v);
    }
    return saida;
  }
  return no;
}

async function viaGemini(prompt, esquema, chave, modelo) {
  const nome = modelo || 'gemini-2.0-flash';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${nome}:generateContent?key=${encodeURIComponent(chave)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: podarParaGemini(JSON.parse(esquema))
        }
      }),
      signal: AbortSignal.timeout(120000)
    });
  if (!r.ok) throw new Error(`gemini respondeu ${r.status}`);
  const corpo = await r.json();
  return lerJson(corpo.candidates?.[0]?.content?.parts?.[0]?.text);
}

/** O modelo às vezes embrulha em cerca de markdown mesmo com schema fechado. */
function lerJson(texto) {
  let limpo = (texto || '').trim();
  if (limpo.startsWith('```')) {
    limpo = limpo.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(limpo);
}

const COM_CHAVE = { anthropic: viaAnthropic, openai: viaOpenai, gemini: viaGemini };

/**
 * Roda a tarefa com o que esta máquina tem.
 *
 * Se há chave configurada, ela vence: foi escolha explícita do dono. Sem chave,
 * cai no que existe na máquina — Claude Code antes do ollama, porque é mais
 * capaz e não custa token extra.
 */
async function executar({ prompt, esquema, provedor, chave, modelo, preferido }) {
  if (chave && COM_CHAVE[provedor]) {
    return COM_CHAVE[provedor](prompt, esquema, chave, modelo);
  }

  const disponiveis = await capacidades();
  const escolhido = preferido || provedor;
  const ordem = escolhido && disponiveis.includes(escolhido)
    ? [escolhido, ...disponiveis.filter((e) => e !== escolhido)]
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
  throw ultimoErro
    || new Error('nenhuma IA disponível: instale o ollama, entre no Claude Code, ou configure uma chave');
}

module.exports = { executar, capacidades, modelosDoOllama };

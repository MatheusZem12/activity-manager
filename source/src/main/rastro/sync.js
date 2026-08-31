/**
 * A ponte com o servidor.
 *
 * Faz duas coisas, nas duas direções:
 *
 *   sobe   os segmentos que o coletor gravou (fatos, nunca conclusões)
 *   desce  tarefas de IA que só esta máquina consegue executar
 *
 * As duas por sondagem de saída. Sua máquina está atrás de NAT residencial: o
 * servidor não consegue te ligar. E nada aqui tem pressa — segmento pode subir
 * minutos depois, classificação é lote.
 *
 * **Nada disto é caminho crítico.** O coletor grava em disco na hora e não
 * espera resposta de rede nenhuma. Servidor fora do ar significa fila crescendo
 * localmente, não funcionalidade perdida.
 */
const fs = require('fs');
const path = require('path');
const store = require('../storage/segment-store');
const { executar, capacidades } = require('./executor');
const servidor = require('./servidor');

const INTERVALO_MS = 5 * 60 * 1000;
const MARCA = 'sincronizado.json';

/** Até onde já subiu. O backend também deduplica, então repetir é inofensivo. */
function lerMarca() {
  const arquivo = path.join(store.segmentsDir(), MARCA);
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return { ate: null };
  }
}

function gravarMarca(marca) {
  fs.mkdirSync(store.segmentsDir(), { recursive: true });
  fs.writeFileSync(path.join(store.segmentsDir(), MARCA), JSON.stringify(marca, null, 2));
}

class Sync {
  /**
   * @param {object} config `{ servidor, token, dispositivo, preferido, modelo }`
   */
  constructor(config) {
    this.config = config;
    this.timer = null;
    this.rodando = false;
  }

  configurado() {
    return Boolean(this.config && this.config.token);
  }

  iniciar() {
    if (!this.configurado()) return false;
    this.ciclo();
    this.timer = setInterval(() => this.ciclo(), INTERVALO_MS);
    if (this.timer.unref) this.timer.unref();
    return true;
  }

  parar() {
    clearInterval(this.timer);
  }

  async api(caminho, opcoes = {}) {
    const r = await fetch(`${servidor.endereco()}/api${caminho}`, {
      ...opcoes,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.token}`,
        ...(opcoes.headers || {})
      },
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) throw new Error(`${caminho} respondeu ${r.status}`);
    return r.json();
  }

  /** Um ciclo: sobe o que há, depois executa o que o servidor pedir. */
  async ciclo() {
    if (this.rodando) return;          // ciclo lento não pode se atropelar
    this.rodando = true;
    try {
      await this.enviarSegmentos();
      await this.executarPendentes();
    } catch (e) {
      // Rede é instável por natureza. Errar um ciclo não é evento: o próximo
      // tenta de novo, e a marca só avança no que foi confirmado.
      this.emitirErro(e);
    } finally {
      this.rodando = false;
    }
  }

  // ------------------------------------------------------------------- sobe

  segmentosNaoEnviados() {
    const marca = lerMarca();
    const pendentes = [];
    for (const dia of store.listDays()) {
      for (const s of store.readDay(dia)) {
        if (marca.ate && s.start <= marca.ate) continue;
        pendentes.push({
          inicio: s.start,
          fim: s.end,
          wmClass: s.wmClass,
          titulo: s.title,
          travado: Boolean(s.travado),
          midia: Boolean(s.midia)
        });
      }
    }
    return pendentes;
  }

  async enviarSegmentos() {
    const pendentes = this.segmentosNaoEnviados();
    if (!pendentes.length) return { gravados: 0 };

    const resposta = await this.api('/segmentos', {
      method: 'POST',
      body: JSON.stringify({
        dispositivo: this.config.dispositivo,
        executores: await capacidades(),
        segmentos: pendentes
      })
    });

    // A marca só avança DEPOIS da confirmação. Avançar antes perderia o lote
    // inteiro num timeout — e o dado não voltaria, porque o JSONL é lido por
    // "o que ainda não subiu".
    gravarMarca({ ate: pendentes[pendentes.length - 1].inicio });
    return resposta;
  }

  // ------------------------------------------------------------------ desce

  async executarPendentes() {
    // Fecha o lote do que está pendente no servidor antes de pedir trabalho.
    await this.api('/ia/enfileirar', { method: 'POST' });

    const { tarefa } = await this.api(
      `/ia/pendentes?dispositivo=${encodeURIComponent(this.config.dispositivo)}`);
    if (!tarefa || !tarefa.id) return null;

    const resposta = await executar({
      prompt: tarefa.prompt,
      esquema: tarefa.esquema,
      provedor: this.config.provedorIa,
      chave: this.config.chaveIa,
      modelo: this.config.modeloIa || this.config.modelo,
      preferido: this.config.preferido
    });

    // O servidor valida índice, categoria e confiança antes de acreditar. Esta
    // máquina executou uma chamada; não ganhou direito de escrever no banco.
    return this.api('/ia/resultado', {
      method: 'POST',
      body: JSON.stringify({ tarefa: tarefa.id, itens: resposta.itens })
    });
  }

  emitirErro(e) {
    if (this.aoErrar) this.aoErrar(e);
  }
}

module.exports = { Sync, lerMarca, gravarMarca };

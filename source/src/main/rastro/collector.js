/**
 * O coletor: junta compositor e ociosidade num fluxo de segmentos.
 *
 * Um segmento é um trecho contínuo em que nada mudou — mesma janela, mesmo
 * título, mesmo estado. Nasce quando algo muda, morre quando algo muda de novo,
 * e só então é gravado.
 *
 * Daí o checkpoint: uma janela em foco por três horas seria um segmento aberto
 * por três horas, e um desligamento abrupto levaria as três embora. A cada
 * CHECKPOINT_MS o segmento aberto é fechado e reaberto idêntico, o que limita a
 * perda ao tamanho da janela. A agregação junta segmentos vizinhos iguais de
 * volta, então isso não aparece no relatório.
 */
const { EventEmitter } = require('events');
const { HyprlandEvents } = require('./hyprland-events');
const { IdleWatcher } = require('./idle');
const segmentStore = require('../storage/segment-store');

const CHECKPOINT_MS = 5 * 60 * 1000;

class Collector extends EventEmitter {
  constructor({ store = segmentStore, now = () => Date.now() } = {}) {
    super();
    this.store = store;
    this.now = now;
    this.hyprland = new HyprlandEvents();
    this.idleWatcher = new IdleWatcher();
    this.open = null;
    this.checkpointTimer = null;
  }

  async start() {
    this.hyprland.on('focus', ({ wmClass, title }) => {
      this.switchTo({ wmClass, title, ...this.idleWatcher.sinais });
    });

    this.idleWatcher.on('changed', (sinais) => {
      // A janela em foco continua a mesma; o que mudou é você estar nela.
      this.switchTo({
        wmClass: this.open ? this.open.wmClass : null,
        title: this.open ? this.open.title : null,
        ...sinais
      });
    });

    this.idleWatcher.start();
    await this.hyprland.start();

    this.checkpointTimer = setInterval(() => this.checkpoint(), CHECKPOINT_MS);
    if (this.checkpointTimer.unref) this.checkpointTimer.unref();
  }

  isSame(a, b) {
    return a.wmClass === b.wmClass && a.title === b.title
        && a.travado === b.travado && a.midia === b.midia;
  }

  /** Fecha o segmento aberto e começa outro — se de fato mudou alguma coisa. */
  switchTo(next) {
    const at = this.now();
    if (this.open && this.isSame(this.open, next)) return;
    this.close(at);
    this.open = { ...next, start: at };
  }

  close(at) {
    if (!this.open) return;
    const segment = { ...this.open, end: at };
    this.open = null;
    if (segment.end <= segment.start) return;
    this.store.appendSegment(segment);
    this.emit('segment', segment);
  }

  checkpoint() {
    if (!this.open) return;
    const at = this.now();
    const reopened = { ...this.open };
    this.close(at);
    this.open = { ...reopened, start: at };
  }

  /** Fecha o que estiver aberto. Chamar no `before-quit` e no SIGTERM. */
  stop() {
    clearInterval(this.checkpointTimer);
    this.close(this.now());
    this.hyprland.stop();
    this.idleWatcher.stop();
  }
}

module.exports = { Collector };

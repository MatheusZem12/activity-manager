/**
 * O que está na sua frente, agora — pelo socket de eventos do compositor.
 *
 * Complementa o `../hypr.js`: aquele *fala* com o Hyprland via `hyprctl` para
 * registrar atalhos e posicionar o painel; este só *escuta*. O compositor
 * publica cada mudança de estado em `.socket2.sock`, uma linha `EVENTO>>DADOS`
 * por vez. Sem polling e sem dependência nova: `net.connect` do Node basta.
 *
 * Dois eventos importam, e escutar só o primeiro é o erro fácil:
 *
 *   activewindow>>classe,titulo      você trocou de janela
 *   windowtitlev2>>endereco,titulo   o título mudou SEM trocar de janela
 *
 * O segundo é o que salva o registro do YouTube. Trocar de vídeo não muda o
 * foco — só o título. Sem `windowtitlev2`, quarenta minutos de vídeos
 * diferentes viram um bloco só, com o nome do primeiro.
 */
const net = require('net');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

// O Hyprland dispara `activewindow` e `activewindowv2` para a mesma troca. Sem
// esta janelinha, cada troca de janela geraria dois segmentos — um deles com
// milissegundos de duração.
const COALESCE_MS = 60;

// Título muda sozinho: notificação, aba carregando, contador no nome da janela.
// Visto ao vivo, o Firefox alternou "Mozilla Firefox" ↔ "Microsoft Teams —
// Mozilla Firefox" três vezes em cinco segundos. Com a espera curta isso vira
// segmento de zero segundo. Um título que não sobrevive dois segundos não era
// o que você estava fazendo — então mudança SÓ de título espera mais, enquanto
// troca de janela continua imediata.
const TITLE_COALESCE_MS = 2000;

const MAX_BACKOFF_MS = 30000;

function socketPath() {
  const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  return `${runtime}/hypr/${process.env.HYPRLAND_INSTANCE_SIGNATURE}/.socket2.sock`;
}

class HyprlandEvents extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.buffer = '';
    this.current = { address: null, wmClass: null, title: null };
    this.lastEmitted = null;
    this.coalesceTimer = null;
    this.reconnectTimer = null;
    this.backoff = 1000;
    this.stopped = false;
  }

  static isAvailable() {
    return Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
  }

  async start() {
    if (!HyprlandEvents.isAvailable()) {
      throw new Error('HYPRLAND_INSTANCE_SIGNATURE ausente — o coletor só roda dentro do Hyprland.');
    }
    // O socket só entrega o que acontecer daqui para frente. Sem semear o
    // estado atual, a janela em que você já estava só apareceria quando você
    // saísse dela — e o tempo até lá se perderia.
    await this.seed();
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.coalesceTimer);
    clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.destroy();
  }

  seed() {
    return new Promise((resolve) => {
      execFile('hyprctl', ['activewindow', '-j'], { timeout: 3000 }, (err, stdout) => {
        if (err) return resolve();
        try {
          const win = JSON.parse(stdout);
          if (win && win.address) {
            this.current = { address: win.address, wmClass: win.class || null, title: win.title || null };
            this.emitFocus();
          }
        } catch { /* nenhuma janela em foco na subida: estado vazio serve */ }
        resolve();
      });
    });
  }

  connect() {
    if (this.stopped) return;
    const socket = net.connect(socketPath());
    this.socket = socket;
    socket.setEncoding('utf8');

    socket.on('connect', () => { this.backoff = 1000; this.emit('connected'); });
    socket.on('data', (chunk) => this.onChunk(chunk));

    // O socket cai quando o Hyprland reinicia. Esperar cada vez mais evita um
    // laço apertado enquanto o compositor ainda está subindo.
    const onGone = () => {
      if (this.stopped) return;
      this.socket = null;
      this.reconnectTimer = setTimeout(() => {
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
        this.seed().then(() => this.connect());
      }, this.backoff);
    };
    socket.on('error', onGone);
    socket.on('close', onGone);
  }

  onChunk(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();          // a última pode estar cortada no meio
    for (const line of lines) this.onLine(line);
  }

  onLine(line) {
    const sep = line.indexOf('>>');
    if (sep === -1) return;
    const event = line.slice(0, sep);
    const data = line.slice(sep + 2);

    switch (event) {
      case 'activewindowv2':
        this.current.address = data || null;
        this.scheduleFocus();
        break;

      case 'activewindow': {
        // O título contém vírgula o tempo todo. Cortar na PRIMEIRA vírgula é
        // obrigatório — um split(',') truncaria metade dos títulos do Firefox.
        const comma = data.indexOf(',');
        if (comma === -1) {                     // `activewindow>>` vazio: foco perdido
          this.current.wmClass = null;
          this.current.title = null;
        } else {
          this.current.wmClass = data.slice(0, comma) || null;
          this.current.title = data.slice(comma + 1) || null;
        }
        this.scheduleFocus();
        break;
      }

      case 'windowtitlev2': {
        const comma = data.indexOf(',');
        if (comma === -1) break;
        // Só interessa se quem mudou de título é a janela em foco: um vídeo
        // tocando atrás não é o que você está fazendo.
        if (data.slice(0, comma) !== this.current.address) break;
        this.current.title = data.slice(comma + 1) || null;
        this.scheduleFocus(TITLE_COALESCE_MS);
        break;
      }

      case 'closewindow':
        if (data === this.current.address) {
          this.current = { address: null, wmClass: null, title: null };
          this.scheduleFocus();
        }
        break;
    }
  }

  scheduleFocus(delay = COALESCE_MS) {
    clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => this.emitFocus(), delay);
  }

  /**
   * Emite só quando o estado de fato mudou. Se o título foi e voltou dentro da
   * espera, o que chega aqui é igual ao último emitido — e não vale um evento.
   */
  emitFocus() {
    const next = { wmClass: this.current.wmClass, title: this.current.title };
    if (this.lastEmitted
        && this.lastEmitted.wmClass === next.wmClass
        && this.lastEmitted.title === next.title) return;
    this.lastEmitted = next;
    this.emit('focus', next);
  }
}

module.exports = { HyprlandEvents };

/**
 * Os dois sinais de que você não está na frente da máquina.
 *
 * Este arquivo **não decide** se você está ocioso — ele reporta os fatos:
 * a tela está travada? há mídia tocando? Quem deriva "ocioso" a partir disso é
 * o backend, e essa separação não é cerimônia: regra no servidor pode ser
 * reaplicada ao histórico inteiro quando você mudar de ideia. Regra assada
 * aqui condena todo dado já coletado.
 *
 * A regra que o servidor aplica hoje é `travado && !midia`, e o porquê é:
 *
 * Assistir uma aula de quarenta minutos gera zero input — e é exatamente o
 * tempo que mais interessa medir. Tratar ausência de teclado como ociosidade
 * inverteria o relatório: os dias de mais estudo apareceriam como os mais
 * parados.
 *
 * Por isso o sinal é outro:
 *
 *     ocioso = (tela travada ou protetor de tela) E NÃO (mídia tocando)
 *
 * O hypridle do omarchy já trava a tela aos 152 segundos, então "travado" e
 * "sem input" praticamente coincidem nesta máquina — e travamento dá para
 * observar de fora, sem tocar em nenhum arquivo de configuração do Hyprland.
 * Regra de Hyprland que falha em silêncio custa uma tarde; não mexer nelas é
 * uma vantagem, não uma limitação.
 */
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const POLL_MS = 15000;

// O próprio `omarchy-launch-screensaver` se identifica com este pgrep — usar o
// mesmo padrão faz a detecção acompanhar o omarchy sem adivinhação.
const LOCK_PROBES = [
  ['pgrep', ['-x', 'hyprlock']],
  ['pgrep', ['-f', 'org.omarchy.screensaver']]
];

function run(cmd, args, timeout = 2000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => {
      // `pgrep` sai com 1 quando não acha nada: isso é resposta, não falha.
      resolve(err ? null : String(stdout).trim());
    });
  });
}

class IdleWatcher extends EventEmitter {
  constructor({ pollMs = POLL_MS } = {}) {
    super();
    this.pollMs = pollMs;
    this.sinais = { travado: false, midia: false };
    this.timer = null;
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  async isLocked() {
    for (const [cmd, args] of LOCK_PROBES) {
      if (await run(cmd, args)) return true;
    }
    return false;
  }

  /**
   * Mídia tocando. O `playerctl` fala MPRIS e responde à pergunta certa — "um
   * player está tocando", não "saiu som". O PipeWire entra como rede de
   * segurança para app sem MPRIS: um stream que existe e não está `Corked` é
   * áudio de verdade, e não o "pop" de uma notificação.
   */
  async isPlaying() {
    if (await run('playerctl', ['status']) === 'Playing') return true;

    const sinks = await run('pactl', ['list', 'sink-inputs']);
    if (!sinks) return false;
    return sinks.split(/Sink Input #/).slice(1).some((b) => /Corked:\s*no/i.test(b));
  }

  async check() {
    const travado = await this.isLocked();
    // Só pergunta pela mídia quando a tela está travada: com você na frente da
    // máquina o dado não muda nada, e são dois processos a menos por ciclo.
    const midia = travado ? await this.isPlaying() : false;
    if (travado === this.sinais.travado && midia === this.sinais.midia) return;
    this.sinais = { travado, midia };
    this.emit('changed', { ...this.sinais });
  }
}

module.exports = { IdleWatcher };

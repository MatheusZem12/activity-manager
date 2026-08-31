/**
 * O coletor rodando fora do Electron.
 *
 * Serve para colher dados desde já, antes de a aba existir — e para depurar o
 * coletor sem reiniciar o app inteiro. Grava no diretório apontado por
 * RASTRO_DIR (ver ../storage/segment-store.js).
 */
const path = require('path');
const os = require('os');

// O MESMO diretório que o Electron usa (`app.getPath('userData')` no Linux é
// $XDG_CONFIG_HOME/<nome do app>). Já foi ~/.local/share e isso criava dois
// acervos separados em silêncio: o coletor avulso gravava num, o app no outro,
// e a sincronização de um nunca via os segmentos do outro.
process.env.RASTRO_DIR = process.env.RASTRO_DIR || path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'activity-manager', 'rastro');

const { Collector } = require('./collector');
const { Sync } = require('./sync');
const config = require('./config');
const store = require('../storage/segment-store');

const collector = new Collector();

collector.on('segment', (s) => {
  const dur = Math.round((s.end - s.start) / 1000);
  const marca = s.state === 'idle' ? 'ocioso' : '      ';
  const hora = new Date(s.start).toTimeString().slice(0, 8);
  console.log(`${hora} ${String(dur).padStart(5)}s ${marca}  ${s.wmClass || '—'}  ${s.title || ''}`);
});

// O `stop()` fecha o segmento aberto. Sem isso, a última janela do dia — que
// costuma ser a mais longa — não entraria no arquivo.
// A sincronização é opcional e nunca bloqueia a coleta. Sem servidor
// configurado, tudo funciona local — só não junta com os outros dispositivos.
const sync = new Sync(config.ler());
sync.aoErrar = (e) => console.error(`[sync] ${e.message}`);

let saindo = false;
function sair() {
  if (saindo) return;
  saindo = true;
  sync.parar();
  collector.stop();
  console.log(`\nGravado em ${store.segmentsDir()}`);
  process.exit(0);
}
process.on('SIGINT', sair);
process.on('SIGTERM', sair);

collector.start()
  .then(() => {
    console.log(`coletando → ${store.segmentsDir()}`);
    console.log(sync.iniciar()
      ? `sincronizando → ${sync.config.servidor} (${sync.config.dispositivo})`
      : `sem servidor: só local. configure em ${config.caminho()}`);
    console.log('(Ctrl+C para parar)\n');
  })
  .catch((e) => { console.error(e.message); process.exit(1); });

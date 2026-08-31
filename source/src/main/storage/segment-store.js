/**
 * Persistência dos segmentos de foco — o registro cru do rastreio.
 *
 * JSONL, um arquivo por dia, append-only. Diferente do `activity-store` e do
 * `entry-store`, que reescrevem um JSON inteiro a cada mudança: aqui o dado é
 * um fluxo — uma troca de janela a cada poucos segundos, o dia todo. Reescrever
 * tudo a cada evento seria caro e, num desligamento abrupto, perderia o dia em
 * vez de perder a última linha.
 *
 * O dia é o **seu** dia: meia-noite local, não UTC. Um segmento que atravessa a
 * virada é partido em dois, para que a soma de um arquivo seja de fato o tempo
 * daquela data.
 */
const fs = require('fs');
const path = require('path');

const DIR_NAME = 'rastro';

/**
 * O `require('electron')` é preguiçoso de propósito: com RASTRO_DIR definido,
 * o coletor roda fora do Electron (ver scripts/coletar.js) para você já colher
 * dados antes de a aba existir.
 */
function segmentsDir() {
  if (process.env.RASTRO_DIR) return process.env.RASTRO_DIR;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), DIR_NAME);
}

function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextMidnight(ms) {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** ISO com o fuso local junto, para o arquivo se explicar sozinho. */
function localIso(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `.${String(d.getMilliseconds()).padStart(3, '0')}`
    + `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

function dayFile(date) {
  return path.join(segmentsDir(), `${date}.jsonl`);
}

/** Parte o segmento na meia-noite local, quantas vezes for preciso. */
function splitAtMidnight(segment) {
  const parts = [];
  let start = segment.start;
  while (start < segment.end) {
    const end = Math.min(segment.end, nextMidnight(start));
    parts.push({ ...segment, start, end });
    start = end;
  }
  return parts;
}

/**
 * Grava um segmento já fechado.
 *
 * Segmentos curtos **não** são descartados: a soma dos registros de um arquivo
 * precisa bater com o relógio de parede, senão nenhum total é confiável. Passar
 * dois segundos por uma janela ao alternar é ruído pequeno — quem decide se
 * mostra é a agregação, não a gravação.
 */
function appendSegment(segment) {
  fs.mkdirSync(segmentsDir(), { recursive: true });
  for (const part of splitAtMidnight(segment)) {
    const line = JSON.stringify({
      start: localIso(part.start),
      end: localIso(part.end),
      seconds: Math.round((part.end - part.start) / 1000),
      wmClass: part.wmClass,
      title: part.title,
      // Fatos, não conclusão: quem deriva "ocioso" é o backend.
      travado: Boolean(part.travado),
      midia: Boolean(part.midia)
    });
    fs.appendFileSync(dayFile(localDate(part.start)), line + '\n');
  }
}

function readDay(date) {
  const file = dayFile(date);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function listDays() {
  const dir = segmentsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .map((n) => n.replace(/\.jsonl$/, ''))
    .sort();
}

module.exports = { appendSegment, readDay, listDays, segmentsDir, localDate, localIso };

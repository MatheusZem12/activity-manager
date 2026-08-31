/**
 * A configuração do rastreio nesta máquina.
 *
 * Fica local e **não sobe para o servidor**: o endereço, o token de sessão e
 * qual executor de IA usar são decisão de cada dispositivo. Um desktop pode
 * preferir o `claude` da máquina, outro o `ollama`, e o celular não executa
 * nada — mas os três alimentam a mesma conta.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../storage/segment-store');

const ARQUIVO = 'servidor.json';

function caminho() {
  return path.join(store.segmentsDir(), ARQUIVO);
}

function padrao() {
  return {
    servidor: '',
    token: '',
    // O nome da máquina serve de identidade: é o que separa "notebook" de
    // "desktop" no mesmo login.
    dispositivo: os.hostname(),
    preferido: 'claudecode',
    modelo: null
  };
}

function ler() {
  try {
    return { ...padrao(), ...JSON.parse(fs.readFileSync(caminho(), 'utf8')) };
  } catch {
    return padrao();
  }
}

function gravar(config) {
  fs.mkdirSync(store.segmentsDir(), { recursive: true });
  fs.writeFileSync(caminho(), JSON.stringify({ ...ler(), ...config }, null, 2), { mode: 0o600 });
  return ler();
}

module.exports = { ler, gravar, caminho };

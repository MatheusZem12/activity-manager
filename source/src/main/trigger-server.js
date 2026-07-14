/**
 * Servidor de gatilho local.
 *
 * O bind do compositor não consegue falar com o processo do Electron
 * diretamente. Em vez de subir um segundo Electron a cada atalho (lento, ~1s),
 * o serviço escuta numa porta de loopback e o script do atalho manda uma linha
 * de texto — a janela rápida abre em milissegundos.
 *
 * A porta só aceita conexões de 127.0.0.1 e os únicos comandos aceitos são
 * "quick" e "open" (abrir uma janela). Nada de dados entra ou sai por aqui.
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FIRST_PORT = 47821;
const LAST_PORT = 47830;

function portFilePath() {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, 'activity-manager.port');
}

/**
 * @param {(command: string) => void} onCommand
 * @returns {Promise<{ port: number, portFile: string }>}
 */
function start(onCommand) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf-8');
      socket.setTimeout(2000, () => socket.destroy());

      socket.once('data', (data) => {
        const command = data.toString().trim().toLowerCase();
        if (command === 'quick' || command === 'open') {
          onCommand(command);
          socket.end('ok\n');
        } else {
          socket.end('unknown\n');
        }
      });

      socket.on('error', () => socket.destroy());
    });

    let port = FIRST_PORT;

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < LAST_PORT) {
        port += 1;
        server.listen(port, '127.0.0.1');
        return;
      }
      reject(err);
    });

    server.on('listening', () => {
      const portFile = portFilePath();
      fs.writeFileSync(portFile, String(port), 'utf-8');
      resolve({ port, portFile });
    });

    server.listen(port, '127.0.0.1');
  });
}

function stop() {
  try {
    fs.unlinkSync(portFilePath());
  } catch {
    // O arquivo some junto com o runtime dir de qualquer forma.
  }
}

module.exports = { start, stop, portFilePath };

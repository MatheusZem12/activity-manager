/**
 * Local trigger server.
 *
 * The compositor bind can't talk to the Electron process directly.
 * Instead of starting a second Electron on every shortcut (slow, ~1s), the
 * service listens on a loopback port and the shortcut script sends one line
 * of text — the quick window opens in milliseconds.
 *
 * The port only accepts connections from 127.0.0.1 and the only accepted
 * commands are "quick" (new activity), "clip" (new text), "panel" and "open"
 * (open the panel). No data comes in or goes out through here.
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
        if (command === 'quick' || command === 'clip' || command === 'panel' || command === 'open') {
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
    // The file goes away with the runtime dir anyway.
  }
}

module.exports = { start, stop, portFilePath };

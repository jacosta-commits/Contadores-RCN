// workers/poller/broadcast.js
'use strict';

/**
 * Broadcast — Direct in-process emission via Socket.IO server bus.
 * No more socket.io-client; the poller runs in the same process.
 */

const logger = require('../../server/lib/logger');

// Lazy references (resolved after server.js has called createSocketServer)
let _telarNs = null;
let _supervisorNs = null;

function _ensureRefs() {
  if (!_telarNs) {
    try {
      const { getIO } = require('../../server/sockets');
      const io = getIO();
      _telarNs = io.of('/telar');
      _supervisorNs = io.of('/supervisor');
    } catch (e) {
      // Socket.IO not ready yet — will retry next call
    }
  }
}

/**
 * initSockets is now a no-op kept for API compat with index.js.
 * The server creates Socket.IO; poller just grabs a reference lazily.
 */
async function initSockets(_WS_URL) {
  logger.info('[broadcast] using direct in-process emission (no socket.io-client)');
}

function emitTelarState(payload) {
  _ensureRefs();
  if (!_telarNs) return;
  const telcod = payload.telcod || payload.tel || payload.key || '';
  const room = `telar:${String(telcod).trim()}`;
  _telarNs.to(room).emit('state', payload);
}

function emitSupervisorState(payload) {
  _ensureRefs();
  if (!_supervisorNs) return;
  // Emit to group room and ALL room (same logic as supervisor.ns.js 'state' handler)
  if (payload.grupo) {
    _supervisorNs.to(`grp:${String(payload.grupo).trim()}`).emit('state', payload);
  }
  _supervisorNs.to('ALL').emit('state', payload);
}

function emitSupervisorAlert(payload) {
  _ensureRefs();
  if (!_supervisorNs) return;
  _supervisorNs.emit('alert', payload);
}

module.exports = { initSockets, emitTelarState, emitSupervisorState, emitSupervisorAlert };

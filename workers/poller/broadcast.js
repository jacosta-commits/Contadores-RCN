// workers/poller/broadcast.js
'use strict';

const { io } = require('socket.io-client');
const env    = require('../../server/lib/env');
const logger = require('../../server/lib/logger');

let telarNS = null;
let supervisorNS = null;

async function initSockets(WS_URL) {
  const base = WS_URL.replace(/\/$/, '');
  telarNS = io(`${base}/telar`, {
    path: env.SOCKET_PATH || '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelayMax: 8000,
    auth: {
      token: env.WORKER_KEY || null,
    },
  });

  supervisorNS = io(`${base}/supervisor`, {
    path: env.SOCKET_PATH || '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelayMax: 8000,
    auth: {
      token: env.WORKER_KEY || null,
    },
  });

  telarNS.on('connect', () => logger.info(`[ws] /telar conectado (${telarNS.id})`));
  telarNS.on('disconnect', (r) => logger.warn(`[ws] /telar desconectado: ${r}`));
  telarNS.on('connect_error', (e) => logger.error(`[ws] /telar connect_error: ${e.message}`));

  supervisorNS.on('connect', () => logger.info(`[ws] /supervisor conectado (${supervisorNS.id})`));
  supervisorNS.on('disconnect', (r) => logger.warn(`[ws] /supervisor desconectado: ${r}`));
  supervisorNS.on('connect_error', (e) => logger.error(`[ws] /supervisor connect_error: ${e.message}`));
}

function emitTelarState(payload) {
  if (telarNS?.connected) {
    // canal de subida al namespace /telar
    telarNS.emit('state.push', payload);
  }
}

function emitSupervisorState(payload) {
  if (supervisorNS?.connected) {
    supervisorNS.emit('state', payload);
  }
}

function emitSupervisorAlert(payload) {
  if (supervisorNS?.connected) {
    supervisorNS.emit('alert', payload);
  }
}

module.exports = { initSockets, emitTelarState, emitSupervisorState, emitSupervisorAlert };

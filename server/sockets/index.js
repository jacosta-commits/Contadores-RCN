'use strict';

const { Server } = require('socket.io');
const logger = require('../lib/logger');
const env = require('../lib/env');

const telarNs = require('./telar.ns');
const supervisorNs = require('./supervisor.ns');

let ioRef = null;

/**
 * Crea el servidor de Socket.IO y registra los namespaces
 * @param {import('http').Server} httpServer
 */
function createSocketServer(httpServer) {
  if (ioRef) return ioRef;

  // AHORA: tratar CORS_ORIGINS como array
  const allowOrigins = Array.isArray(env.CORS_ORIGINS) ? env.CORS_ORIGINS : ['*'];
  const originOption = (allowOrigins.length === 1 && allowOrigins[0] === '*') ? true : allowOrigins;

  const io = new Server(httpServer, {
    path: env.SOCKET_PATH || '/socket.io',
    cors: {
      origin: originOption,                       // true => permite cualquier Origin
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: !!env.CORS_CREDENTIALS,
    },
    pingInterval: 20000,
    pingTimeout: 20000,
    allowEIO3: false,
  });

  io.engine.on('connection_error', (err) => {
    logger.error('[socket] engine connection error:', {
      code: err.code, message: err.message, context: err.context
    });
  });

  // Middlewares globales (si luego quieres auth por token, etc.)
  io.use((socket, next) => {
    // Ejemplo: const token = socket.handshake.auth?.token;
    // if (!token) return next(new Error('unauthorized'));
    return next();
  });

  // Registra namespaces
  telarNs.setup(io);
  supervisorNs.setup(io);

  // Logs
  io.on('connection', (socket) => {
    // (No se usa; casi todo vive en namespaces)
    logger.debug(`[socket:*] client connected id=${socket.id}`);
  });

  ioRef = io;
  logger.info('[socket] Socket.IO ready');
  return io;
}

/** Devuelve la instancia actual de io (si ya fue creada) */
function getIO() {
  if (!ioRef) {
    throw new Error('Socket.IO no inicializado. Llama createSocketServer(server) primero.');
  }
  return ioRef;
}

/** Puente para que otros módulos (workers) emitan sin importar los NS internos */
const bus = {
  telar: {
    /** Emite el estado actualizado de un telar a su sala */
    state(telcod, payload) {
      telarNs.emitToTelar(telcod, 'state', payload);
    },
    /** Emite una alerta ligada a un telar */
    alerta(telcod, payload) {
      telarNs.emitToTelar(telcod, 'alerta', payload);
    },
    /** Notifica creación/actualización de llamada del telar */
    llamada(event, telcod, payload) {
      telarNs.emitToTelar(telcod, `llamada.${event}`, payload);
      supervisorNs.emitToAll(`llamada.${event}`, payload); // también a supervisores
    },
  },
  supervisor: {
    /** Broadcast de KPIs agregados por grupo o global */
    kpis(payload, grupo = null) {
      if (grupo) supervisorNs.emitToGroup(grupo, 'kpis', payload);
      else supervisorNs.emitToAll('kpis', payload);
    },
    /** Broadcast de snapshot simple por telar para grillas */
    contador(payload, grupo = null) {
      if (grupo) supervisorNs.emitToGroup(grupo, 'contador', payload);
      else supervisorNs.emitToAll('contador', payload);
    },
    /** Mensajes generales (alertas, avisos) al tablero supervisor */
    alerta(payload, grupo = null) {
      if (grupo) supervisorNs.emitToGroup(grupo, 'alerta', payload);
      else supervisorNs.emitToAll('alerta', payload);
    },
  },
};

module.exports = {
  createSocketServer,
  getIO,
  bus,
};

'use strict';

const logger = require('../lib/logger');
const env = require('../lib/env');

// Servicios (se mantienen igual)
const llamadaSvc = require('../services/llamada.service');
const checklistSvc = require('../services/checklist.service');
const lecturaSvc = require('../services/lectura.service');
const cacheSvc = require('../services/cache.service');

const NS = '/telar';
const roomOf = (telcod) => `telar:${String(telcod).trim()}`;

let ioRef = null;

/** Enviar a la sala de un telar */
function emitToTelar(telcod, event, payload) {
  if (!ioRef) return;
  const room = roomOf(telcod);
  // 🔍 LOG para ver qué se está emitiendo y a qué room
  logger.debug(
    `[socket${NS}] emit ${event} → room=${room}`,
    { telcod, keys: Object.keys(payload || {}) }
  );
  ioRef.of(NS).to(room).emit(event, payload);
}

function isWorker(socket) {
  const token =
    socket.handshake?.auth?.token ||
    socket.handshake?.headers?.['x-worker-key'] ||
    socket.handshake?.query?.token;
  if (!env.WORKER_KEY) return true;      // sin clave → permitir (dev)
  return token === env.WORKER_KEY;
}

async function joinMany(socket, telcods, ack) {
  try {
    const list = (telcods || [])
      .map(t => String(t).trim())
      .filter(Boolean);

    if (!list.length) throw new Error('telcod requerido');

    // 🔍 LOG para ver a qué telares se une cada socket
    logger.debug(`[socket${NS}] joinMany socket=${socket.id} telcods=${list.join(',')}`);

    // Sal de cualquier sala previa distinta si era un único join viejo
    const rooms = socket.rooms || new Set();
    for (const r of rooms) {
      if (r.startsWith('telar:') && !list.includes(r.replace('telar:', ''))) {
        await socket.leave(r);
      }
    }

    // Únete a todas
    for (const t of list) await socket.join(roomOf(t));

    // Snapshot inicial (desde caché) por cada telcod
    try {
      const rec = await cacheSvc.getRecovery(); // array
      for (const t of list) {
        const snap = (rec || []).find(r => r.telcod === t);
        if (snap) socket.emit('snapshot', { telcod: t, ...snap });
      }
    } catch (e) {
      logger.warn(`[socket${NS}] snapshot cache error: ${e.message}`);
    }

    const res = { ok: true, telcods: list };
    if (typeof ack === 'function') return ack(res);
    socket.emit('joined', res);
  } catch (err) {
    const res = { ok: false, error: err.message || 'join failed' };
    if (typeof ack === 'function') return ack(res);
    socket.emit('error', res);
  }
}

async function leaveMany(socket, telcods, ack) {
  try {
    const list = (telcods === '*' ? ['*'] :
      (Array.isArray(telcods) ? telcods : [telcods]))
      .map(t => String(t).trim())
      .filter(Boolean);

    if (list.includes('*')) {
      for (const r of socket.rooms) {
        if (r.startsWith('telar:')) await socket.leave(r);
      }
    } else {
      for (const t of list) await socket.leave(roomOf(t));
    }

    const res = { ok: true, telcods: list };
    if (typeof ack === 'function') return ack(res);
    socket.emit('left', res);
  } catch (err) {
    const res = { ok: false, error: err.message || 'leave failed' };
    if (typeof ack === 'function') return ack(res);
    socket.emit('error', res);
  }
}

function setup(io) {
  ioRef = io;
  const nsp = io.of(NS);

  nsp.on('connection', (socket) => {
    logger.debug(`[socket${NS}] ${socket.id} connected`);

    // --- JOIN (ahora acepta objeto, string o array) ---
    socket.on('join', (payload = {}, ack) => {
      let telcods = [];
      if (Array.isArray(payload)) telcods = payload;
      else if (Array.isArray(payload.telcods)) telcods = payload.telcods;
      else if (payload.telcod) telcods = [payload.telcod];
      else if (typeof payload === 'string') telcods = [payload];
      return joinMany(socket, telcods, ack);
    });

    // --- Compat con front actual ---
    socket.on('rooms:join', (payload = {}, ack) => {
      const telcods = Array.isArray(payload.telcods) ? payload.telcods : [];
      return joinMany(socket, telcods, ack);
    });

    socket.on('leave', (payload = {}, ack) => {
      let telcods = [];
      if (payload === '*') telcods = '*';
      else if (Array.isArray(payload)) telcods = payload;
      else if (Array.isArray(payload.telcods)) telcods = payload.telcods;
      else if (payload.telcod) telcods = [payload.telcod];
      return leaveMany(socket, telcods, ack);
    });

    socket.on('rooms:leave', (payload = {}, ack) => {
      const telcods = (payload === '*' ? '*' : (payload.telcods || []));
      return leaveMany(socket, telcods, ack);
    });

    // --- Ping/Pong ---
    socket.on('ping', (data, ack) => {
      const res = { ok: true, ts: Date.now(), data };
      if (typeof ack === 'function') return ack(res);
      socket.emit('pong', res);
    });

    // ===== Checklist (igual que antes) =====
    socket.on('checklist.upsert', async (body = {}, ack) => {
      try {
        const saved = await checklistSvc.upsert(body);
        const res = { ok: true, data: saved };
        if (typeof ack === 'function') return ack(res);
        socket.emit('checklist.ok', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'checklist failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('checklist.error', res);
      }
    });

    // ===== Llamadas (igual) =====
    socket.on('llamada.crear', async (body = {}, ack) => {
      try {
        const created = await llamadaSvc.crear(body);
        if (created?.telcod) emitToTelar(created.telcod, 'llamada.new', created);
        const res = { ok: true, data: created };
        if (typeof ack === 'function') return ack(res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'llamada failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('llamada.error', res);
      }
    });

    socket.on('llamada.actualizar', async (body = {}, ack) => {
      try {
        if (!body.id) throw new Error('id requerido');
        const updated = await llamadaSvc.actualizar(body);
        if (updated?.telcod) emitToTelar(updated.telcod, 'llamada.update', updated);
        const res = { ok: true, data: updated };
        if (typeof ack === 'function') return ack(res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'llamada update failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('llamada.error', res);
      }
    });

    // ===== Lecturas manuales (igual) =====
    socket.on('lectura.manual', async (body = {}, ack) => {
      try {
        const saved = await lecturaSvc.registrarManual(body);
        const res = { ok: true, data: saved };
        if (typeof ack === 'function') return ack(res);
        socket.emit('lectura.ok', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'lectura failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('lectura.error', res);
      }
    });

    // ===== Canal de subida para el worker =====
    // Acepta 'state.push' o 'state' (por compat), re-emite a la sala.
    const handleUp = (body = {}, ack) => {
      try {
        if (!isWorker(socket)) throw new Error('unauthorized');
        const telcod = String(body.telcod || body.tel || body.key || '').trim();
        if (!telcod) throw new Error('telcod requerido');
        emitToTelar(telcod, 'state', body);
        const res = { ok: true };
        if (typeof ack === 'function') return ack(res);
      } catch (err) {
        const res = { ok: false, error: err.message };
        if (typeof ack === 'function') return ack(res);
        socket.emit('error', res);
      }
    };
    socket.on('state.push', handleUp);
    socket.on('state', handleUp); // compat por si el worker ya envía 'state'

    socket.on('disconnect', (reason) => {
      logger.debug(`[socket${NS}] ${socket.id} disconnected (${reason})`);
    });
  });

  logger.info(`[socket] namespace ${NS} listo`);
}

module.exports = {
  setup,
  emitToTelar,
};

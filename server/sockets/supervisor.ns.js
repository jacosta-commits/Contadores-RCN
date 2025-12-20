'use strict';

const logger = require('../lib/logger');
const supervisorSvc = require('../services/supervisor.service');

const NS = '/supervisor';
const roomGroup = (grupo) => `grp:${String(grupo).trim()}`;

let ioRef = null;

/** Emite a TODO el namespace supervisor */
function emitToAll(event, payload) {
  if (!ioRef) return;
  ioRef.of(NS).emit(event, payload);
}

/** Emite solo a un grupo específico (sala grp:XXX) */
function emitToGroup(grupo, event, payload) {
  if (!ioRef) return;
  ioRef.of(NS).to(roomGroup(grupo)).emit(event, payload);
}

function setup(io) {
  ioRef = io;

  const nsp = io.of(NS);

  nsp.on('connection', (socket) => {
    let joinedGroups = new Set();

    // Recibir estado del poller y retransmitir a clientes
    socket.on('state', (payload) => {
      // 1. Emitir a sala específica del grupo (si tiene)
      if (payload.grupo) {
        socket.to(roomGroup(payload.grupo)).emit('state', payload);
      }
      // 2. Emitir a sala 'ALL' (para vista general)
      socket.to('ALL').emit('state', payload);
    });

    // Unirse a 1+ grupos (Rashell, Muketsu, Consumo, Anchoveteros)
    socket.on('join.group', async (payload = {}, ack) => {
      try {
        const grupo = String(payload.grupo || '').trim();
        if (!grupo) throw new Error('grupo requerido');

        await socket.join(roomGroup(grupo));
        joinedGroups.add(grupo);

        const res = { ok: true, grupo };
        if (typeof ack === 'function') return ack(res);
        socket.emit('joined.group', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'join.group failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('error', res);
      }
    });

    // Salir de un grupo
    socket.on('leave.group', async (payload = {}, ack) => {
      try {
        const grupo = String(payload.grupo || '').trim();
        if (!grupo) throw new Error('grupo requerido');

        await socket.leave(roomGroup(grupo));
        joinedGroups.delete(grupo);

        const res = { ok: true, grupo };
        if (typeof ack === 'function') return ack(res);
        socket.emit('left.group', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'leave.group failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('error', res);
      }
    });

    // Unirse a "todo" (sin filtro de grupo)
    socket.on('join.all', async (_ = {}, ack) => {
      try {
        await socket.join('ALL');
        const res = { ok: true };
        if (typeof ack === 'function') return ack(res);
        socket.emit('joined.all', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'join.all failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('error', res);
      }
    });

    // KPIs bajo demanda (útil al cargar el tablero)
    socket.on('kpis.get', async (payload = {}, ack) => {
      try {
        const { grupo = null, turno = null, base = null } = payload;
        const baseDate = base ? new Date(base) : new Date();
        if (base && Number.isNaN(baseDate.getTime())) throw new Error('base inválido');

        const data = await supervisorSvc.getKPIs({
          grupo: grupo || null,
          turno_cod: turno || null,
          base_date: baseDate,
        });

        const res = { ok: true, data };
        if (typeof ack === 'function') return ack(res);
        socket.emit('kpis.data', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'kpis.get failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('kpis.error', res);
      }
    });

    // Resumen por sesión/telar (para modal de detalle)
    socket.on('resumen.get', async (payload = {}, ack) => {
      try {
        const { sescod = null, telcod = null } = payload || {};
        const data = await supervisorSvc.getResumenSesionTelar({ sescod, telcod });
        const res = { ok: true, data };
        if (typeof ack === 'function') return ack(res);
        socket.emit('resumen.data', res);
      } catch (err) {
        const res = { ok: false, error: err.message || 'resumen.get failed' };
        if (typeof ack === 'function') return ack(res);
        socket.emit('resumen.error', res);
      }
    });

    socket.on('ping', (data, ack) => {
      const res = { ok: true, ts: Date.now(), data };
      if (typeof ack === 'function') return ack(res);
      socket.emit('pong', res);
    });

    socket.on('disconnect', (reason) => {
      joinedGroups.clear();
      logger.debug(`[socket${NS}] ${socket.id} disconnected (${reason})`);
    });
  });

  logger.info(`[socket] namespace ${NS} listo`);
}

module.exports = {
  setup,
  emitToAll,
  emitToGroup,
};

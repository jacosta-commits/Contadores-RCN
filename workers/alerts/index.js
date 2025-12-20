'use strict';

/**
 * Motor de alertas simple:
 *  - velocidad == 0 por >= ZERO_SEC  → alerta 'velocidad_cero'
 *  - hil_act no cambia por >= STALL_SEC → alerta 'sin_avance'
 *
 * Se alimenta desde /api/v1/cache/recovery (pull) para no acoplarse a sockets.
 */

const { setTimeout: delay } = require('timers/promises');
const env = require('../../server/lib/env');
const logger = require('../../server/lib/logger');
const { pullRecovery } = require('../poller/cache.sync');
const { emitSupervisorAlert, initSockets } = require('../poller/broadcast');

const API_BASE = env.API_BASE || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}/api/v1`;
const WS_URL   = env.WS_URL  || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}`;

const SCAN_MS    = Number(env.ALERT_SCAN_MS || 5_000);
const ZERO_SEC   = Number(env.ALERT_ZERO_VELOCITY_SEC || 60);
const STALL_SEC  = Number(env.ALERT_STALL_SEC || 120);

const track = new Map(); // telcod -> { lastHil, lastTs, zeroSince, stallSince, grupo }

function nowISO() { return new Date().toISOString(); }

function updateTrack(r) {
  const t = track.get(r.telcod) || {
    lastHil: r.hil_act,
    lastTs: Date.now(),
    zeroSince: (r.velocidad === 0 ? Date.now() : null),
    stallSince: null,
    grupo: r.grupo || null,
  };

  const now = Date.now();

  // ZERO
  if (r.velocidad === 0) {
    if (!t.zeroSince) t.zeroSince = now;
  } else {
    t.zeroSince = null;
  }

  // STALL (sin avance)
  if (r.hil_act === t.lastHil) {
    if (!t.stallSince) t.stallSince = now;
  } else {
    t.stallSince = null;
  }

  t.lastHil = r.hil_act;
  t.lastTs = now;
  t.grupo = r.grupo || t.grupo;

  track.set(r.telcod, t);
  return t;
}

async function scan() {
  const rec = await pullRecovery(API_BASE);
  const when = nowISO();

  for (const r of rec) {
    if (!r.session_active) continue; // alertas solo si hay sesión

    // r no incluye grupo en recovery; si lo necesitas, añade en la API /telares o guarda en caché
    const t = updateTrack(r);

    if (t.zeroSince && (Date.now() - t.zeroSince) >= ZERO_SEC * 1000) {
      emitSupervisorAlert({
        tipo: 'velocidad_cero',
        grupo: t.grupo || '(N/A)',
        telcod: r.telcod,
        ts: when,
        seconds: Math.floor((Date.now() - t.zeroSince) / 1000),
      });
    }

    if (t.stallSince && (Date.now() - t.stallSince) >= STALL_SEC * 1000) {
      emitSupervisorAlert({
        tipo: 'sin_avance',
        grupo: t.grupo || '(N/A)',
        telcod: r.telcod,
        ts: when,
        seconds: Math.floor((Date.now() - t.stallSince) / 1000),
      });
    }
  }
}

async function main() {
  await initSockets(WS_URL);
  for (;;) {
    try { await scan(); }
    catch (e) { logger.warn('[alerts] error:', e.message); }
    await delay(SCAN_MS);
  }
}

if (require.main === module) {
  main().catch((e) => {
    logger.error('[alerts] crash:', e);
    process.exit(1);
  });
}

module.exports = { main };

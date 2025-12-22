'use strict';

/**
 * Orquesta lecturas por grupo:
 *  - Carga mapa (VW_RCN_CONT_TELAR_MAP) desde API
 *  - Lee PLC o CALC
 *  - Upsert en /api/v1/cache (recuperación)
 *  - Emite por websockets (/telar y /supervisor)
 */

const { setTimeout: delay } = require('timers/promises');
const env = require('../../server/lib/env');
const logger = require('../../server/lib/logger');

const { loadMap } = require('./map.loader');
const { readPLC, readPulse } = require('./modbus.reader');
const { seedFromCache, computeFromPulse } = require('./calc.reader');
const { upsertCache, pullRecovery } = require('./cache.sync');
const { initSockets, emitTelarState, emitSupervisorState } = require('./broadcast');

const API_BASE = env.API_BASE || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}/api/v1`;
const WS_URL = env.WS_URL || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}`;
const GROUP = env.POLLER_GROUP || null;            // null = todos
const PERIOD_MS = Number(env.POLLER_PERIOD_MS || 1000);
const CONC = Math.max(1, Number(env.POLLER_CONCURRENCY || 8));
const JITTER = Number(env.POLLER_JITTER_MS || 50);
const PPR = Number(env.PULSES_PER_ROW || 10);    // CALC: pulsos por hilera

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function primeCalcBaselines() {
  try {
    const rec = await pullRecovery(API_BASE);
    for (const r of rec) {
      seedFromCache({
        telcod: r.telcod,
        hil_act: r.hil_act,
        hil_turno: r.hil_turno,
        hil_start: r.hil_start,
        set_value: r.set_value,
      });
    }
    logger.info(`[poller] baselines CALC sembradas desde recovery (${rec.length})`);
  } catch (e) {
    logger.warn('[poller] no se pudo sembrar baselines desde recovery:', e.message);
  }
}

async function cycle(telar) {
  const ts = new Date();
  let snapshot = null;

  try {
    if (telar.mode === 'PLC') {
      // PLC: Solo inyectar hil_start para calcular offset
      const s = require('./calc.reader').getState(telar.telarKey);
      if (s && s.hil_start !== undefined) {
        telar.hil_start = s.hil_start;
      }
      snapshot = await readPLC(telar);
    } else {
      // CALC: Lógica normal
      const pulse = await readPulse(telar);
      snapshot = computeFromPulse({ telar, pulse, ts, pulsesPerRow: PPR });
    }

    // Upsert cache
    const serverState = await upsertCache(API_BASE, {
      telcod: telar.telarKey,
      // NO ENVIAR metadata de sesión para no sobrescribirla con null/0
      // sescod: snapshot.sescod ?? null,
      // tracod: snapshot.tracod ?? null,
      // traraz: snapshot.traraz ?? null,
      // turno_cod: snapshot.turno_cod ?? null,
      // session_active: snapshot.session_active ?? 0,
      hil_act: snapshot.hil_act ?? 0,
      hil_turno: snapshot.hil_turno ?? 0,
      // hil_start: snapshot.hil_start, // NO ENVIAR: Dejar que el servidor decida (preservar DB)
      velocidad: snapshot.velocidad ?? 0,
    });

    // SYNC: Solo para CALC y cambios de sesión
    if (serverState?.data) {
      const srv = serverState.data;
      let dirty = false;

      // 1. Sincronizar sesiones
      if (snapshot.session_active === 1 && srv.session_active === 0) {
        logger.info(`[poller] SYNC: servidor forzó cierre sesión telar=${telar.telarKey}`);
        dirty = true;
      } else if (snapshot.session_active === 0 && srv.session_active === 1) {
        logger.info(`[poller] SYNC: servidor indica sesión activa telar=${telar.telarKey}`);
        dirty = true;
      }

      // 2. Sincronizar hil_start si difiere (CRÍTICO: así el poller se entera del reset)
      // 2. Sincronizar hil_start si difiere (CRÍTICO: así el poller se entera del reset)
      if (srv.hil_start !== undefined && srv.hil_start !== snapshot.hil_start) {
        logger.debug(`[poller] SYNC: hil_start divergió (local=${snapshot.hil_start}, server=${srv.hil_start}). Actualizando local.`);

        // Actualizamos memoria
        seedFromCache({
          telcod: telar.telarKey,
          hil_start: srv.hil_start
        });

        // Actualizamos snapshot actual para que el siguiente ciclo use el nuevo offset
        snapshot.hil_start = srv.hil_start;

        // CRÍTICO: Recalcular hil_turno inmediatamente con el nuevo offset
        // para evitar que el siguiente ciclo envíe el valor viejo
        if (snapshot.hil_act !== undefined) {
          const newHilTurno = Math.max(0, snapshot.hil_act - srv.hil_start);
          logger.debug(`[poller] SYNC: Recalculando hil_turno con nuevo offset (hil_act=${snapshot.hil_act}, new_offset=${srv.hil_start}, new_turno=${newHilTurno})`);
          snapshot.hil_turno = newHilTurno;
          dirty = true;
        }
      }

      // 2b. Sync hil_act if server value differs (prevent reset)
      if (srv.hil_act !== undefined && srv.hil_act !== snapshot.hil_act) {
        logger.debug(`[poller] SYNC: hil_act divergió (local=${snapshot.hil_act}, server=${srv.hil_act}). Actualizando local.`);
        snapshot.hil_act = srv.hil_act;
        dirty = true;
      }

      // 3. SOLO PARA CALC: Detectar reset manual
      if (telar.mode === 'CALC' && srv.hil_act === 0 && snapshot.hil_act > 0) {
        logger.info(`[poller] SYNC: Detectado RESET CALC en servidor (local=${snapshot.hil_act}, server=0). Reseteando local.`);

        const newStart = snapshot.hil_act_raw ?? snapshot.hil_act;
        seedFromCache({
          telcod: telar.telarKey,
          hil_start: newStart,
          hil_act: 0,
        });

        snapshot.hil_start = newStart;
        snapshot.hil_act = 0;
        srv.hil_start = newStart; // Para que no se sobrescriba después
        dirty = true;
      }

      // 4. Sincronizar set_value
      if (srv.set_value !== undefined && srv.set_value !== snapshot.set_value) {
        dirty = true;
      }

      if (dirty) {
        seedFromCache({
          telcod: telar.telarKey,
          hil_act: srv.hil_act,
          hil_turno: srv.hil_turno,
          hil_start: srv.hil_start,
          session_active: srv.session_active,
          set_value: srv.set_value,
        });

        snapshot.session_active = srv.session_active;
        snapshot.hil_start = srv.hil_start;
        snapshot.hil_act = srv.hil_act;
        snapshot.hil_turno = srv.hil_turno;
        snapshot.set_value = srv.set_value;
      }

      // CRÍTICO: Inyectar metadata de sesión (Operario, Turno, Hora) desde el servidor al snapshot
      // para que el Supervisor pueda mostrar quién está trabajando.

      if (srv.session_active) {
        snapshot.session_active = 1;
        snapshot.tracod = srv.tracod;
        snapshot.traraz = srv.traraz;
        snapshot.turno_cod = srv.turno_cod;
        snapshot.inicio_dt = srv.inicio_dt || srv.updated_at; // Fallback a updated_at si inicio_dt no viene

        // DEBUG: Verificar qué estamos inyectando
        logger.debug(`[poller] Metadata injected for ${telar.telarKey}: ${JSON.stringify({ tracod: srv.tracod, traraz: srv.traraz })}`);
      } else {
        snapshot.session_active = 0;
        snapshot.tracod = null;
        snapshot.traraz = null;
        snapshot.turno_cod = null;
        snapshot.inicio_dt = null;
      }
    }

    // Emit
    emitTelarState({
      telcod: telar.telarKey,
      ts: ts.toISOString(),
      telnom: telar.telnom,
      grupo: telar.grupo,
      ...snapshot,
    });

    emitSupervisorState({
      grupo: telar.grupo,
      telcod: telar.telarKey,
      ts: ts.toISOString(),
      telnom: telar.telnom,
      ...snapshot,
    });

  } catch (err) {
    logger.warn(`[poller] fallo lectura telar=${telar.telarKey} (${telar.mode}): ${err.message}`);
  }
}

async function main() {
  logger.info(`[poller] inicio → group=${GROUP || '(todos)'} period=${PERIOD_MS}ms conc=${CONC} PPR=${PPR}`);
  await initSockets(WS_URL);

  const mapa = await loadMap(API_BASE, GROUP);
  if (!mapa.length) {
    logger.warn('[poller] mapa vacío, nada que leer');
  } else {
    logger.info(`[poller] mapa cargado: ${mapa.length} telares`);
  }

  await primeCalcBaselines();

  for (; ;) {
    const startLoop = Date.now();

    for (const batch of chunk(mapa, CONC)) {
      await Promise.allSettled(
        batch.map(async (telar) => {
          if (!telar || !telar.telarKey) return;
          await delay(Math.random() * JITTER);
          await cycle(telar);
        })
      );
    }

    const spent = Date.now() - startLoop;
    const sleep = Math.max(0, PERIOD_MS - spent);
    if (sleep > 0) await delay(sleep);
  }
}

if (require.main === module) {
  main().catch((e) => {
    logger.error('[poller] crash:', e);
    process.exit(1);
  });
}

module.exports = { main };

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
const persistence = require('./persistence');

const API_BASE = env.API_BASE || `http://127.0.0.1:${env.PORT || 8080}/api/v1`;
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
  // 1. Intentar cargar desde disco (Rápido)
  const localState = persistence.load();
  if (localState.length > 0) {
    logger.info(`[poller] baselines cargadas desde disco (${localState.length})`);
    // Init persistence baseline from disk (Best effort)
    persistence.initState(localState);
    for (const r of localState) {
      seedFromCache(r);
    }
    return; // Éxito rápido
  }

  // 2. Fallback a DB (Lento)
  let attempts = 0;
  while (true) {
    try {
      attempts++;
      const rec = await pullRecovery(API_BASE);
      // Init persistence baseline from DB (Authoritative)
      persistence.initState(rec);
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
      break; // Éxito
    } catch (e) {
      logger.warn(`[poller] fallo al sembrar baselines (intento ${attempts}): ${e.message}`);
      await delay(2000); // Esperar 2s antes de reintentar
    }
  }
}

async function cycle(telar) {
  // Backoff: Si falló recientemente, saltar para no bloquear el ciclo
  if (telar.nextRetry && Date.now() < telar.nextRetry) return;

  // logger.debug(`[poller] cycle start for ${telar.telarKey}`);
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

    // Upsert cache via Persistence (Write-Behind)
    const serverState = await persistence.process(API_BASE, {
      telcod: telar.telarKey,
      hil_act: snapshot.hil_act ?? 0,
      hil_turno: snapshot.hil_turno ?? 0,
      velocidad: snapshot.velocidad ?? 0,
      last_offset: telar.hil_acum_offset || 0, // CRÍTICO: Para evitar sobrescribir un reset pendiente
      // Pasamos campos extra para que persistence pueda detectar cambios críticos
      // session_active: snapshot.session_active ?? 0, // REMOVED: Poller is not authoritative for session
      counters_only: true, // NEW: Prevent overwriting session data in DB
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
      if (srv.hil_start !== undefined && srv.hil_start !== snapshot.hil_start) {
        logger.debug(`[poller] SYNC: hil_start divergió (local=${snapshot.hil_start}, server=${srv.hil_start}). Actualizando local.`);

        // Actualizamos memoria
        seedFromCache({
          telcod: telar.telarKey,
          hil_start: srv.hil_start,
          hil_turno: Math.max(0, snapshot.hil_act - srv.hil_start) // CRÍTICO: Resetear turno en memoria
        });

        // Actualizamos snapshot actual para que el siguiente ciclo use el nuevo offset
        snapshot.hil_start = srv.hil_start;

        // CRÍTICO: Recalcular hil_turno inmediatamente con el nuevo offset
        // SOLO para CALC. Para PLC, hil_turno viene del PLC.
        if (snapshot.hil_act !== undefined && telar.mode !== 'PLC') {
          const newHilTurno = Math.max(0, snapshot.hil_act - srv.hil_start);
          logger.debug(`[poller] SYNC: Recalculando hil_turno con nuevo offset (hil_act=${snapshot.hil_act}, new_offset=${srv.hil_start}, new_turno=${newHilTurno})`);
          snapshot.hil_turno = newHilTurno;
          srv.hil_turno = newHilTurno; // CRÍTICO: Actualizar srv para que el bloque dirty no lo sobrescriba con el valor viejo
          dirty = true;
        }
      }

      // 2b. Sync hil_act if server value differs (prevent reset)
      if (srv.hil_act !== undefined && srv.hil_act !== snapshot.hil_act) {
        // Solo sincronizar si la diferencia es significativa o si es un reset
        if (srv.hil_act !== snapshot.hil_act) {
          logger.debug(`[poller] SYNC: hil_act divergió (local=${snapshot.hil_act}, server=${srv.hil_act}). Actualizando local.`);
          snapshot.hil_act = srv.hil_act;
          dirty = true;
        }
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

      // 5. Sincronizar hil_acum_offset (CRÍTICO para reset instantáneo)
      if (srv.hil_acum_offset !== undefined && srv.hil_acum_offset !== (telar.hil_acum_offset || 0)) {
        logger.debug(`[poller] SYNC: hil_acum_offset divergió (local=${telar.hil_acum_offset}, server=${srv.hil_acum_offset}). Actualizando local.`);
        telar.hil_acum_offset = srv.hil_acum_offset;
      }

      // CRÍTICO: Inyectar metadata de sesión (Operario, Turno, Hora) desde el servidor al snapshot
      if (srv.session_active) {
        snapshot.session_active = 1;
        snapshot.tracod = srv.tracod;
        snapshot.traraz = srv.traraz;
        snapshot.turno_cod = srv.turno_cod;
        snapshot.inicio_dt = srv.inicio_dt || srv.updated_at; // Fallback a updated_at si inicio_dt no viene
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

    // Éxito: Limpiar backoff si existía
    if (telar.nextRetry) telar.nextRetry = 0;

  } catch (err) {
    logger.warn(`[poller] fallo lectura telar=${telar.telarKey} (${telar.mode}): ${err.message}`);
    // Backoff: Si falla, esperar 10s antes de reintentar este telar
    telar.nextRetry = Date.now() + 10000;
  }
}

async function main() {
  logger.info(`[poller] inicio → group=${GROUP || '(todos)'} period=${PERIOD_MS}ms conc=${CONC} PPR=${PPR}`);
  await initSockets(WS_URL);

  let mapa = [];
  while (true) {
    try {
      mapa = await loadMap(API_BASE, GROUP);
      if (mapa.length > 0) {
        logger.info(`[poller] mapa cargado: ${mapa.length} telares`);
        break;
      }
      logger.warn('[poller] mapa vacío, reintentando en 5s...');
    } catch (e) {
      logger.warn(`[poller] fallo al cargar mapa inicial: ${e.message}. Reintentando en 5s...`);
    }
    await delay(5000);
  }

  await primeCalcBaselines();

  let lastMapUpdate = Date.now();

  // Heartbeat Stats
  let cyclesCount = 0;
  let cyclesTimeAccum = 0;
  let lastHeartbeat = Date.now();

  // Worker Pool Helper
  const runPool = async (items, concurrency) => {
    const queue = [...items];
    const workers = [];

    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const telar = queue.shift();
          if (!telar || !telar.telarKey) continue;

          // Jitter para evitar "thundering herd"
          if (JITTER > 0) await delay(Math.random() * JITTER);

          // Watchdog & Cycle
          const startCycle = Date.now();
          await cycle(telar);
          const duration = Date.now() - startCycle;

          // Watchdog: Log if cycle is too slow (> 500ms)
          if (duration > 500) {
            logger.warn(`[poller] SLOW CYCLE: ${telar.telarKey} took ${duration}ms`);
          }
        }
      })());
    }

    await Promise.allSettled(workers);
  };

  for (; ;) {
    const startLoop = Date.now();

    // Heartbeat (Every 60s)
    if (Date.now() - lastHeartbeat > 60000) {
      const avg = cyclesCount > 0 ? (cyclesTimeAccum / cyclesCount).toFixed(1) : 0;
      logger.info(`[poller] HEARTBEAT: ${cyclesCount} loops/min. Avg loop time: ${avg}ms. Map size: ${mapa.length}`);
      cyclesCount = 0;
      cyclesTimeAccum = 0;
      lastHeartbeat = Date.now();
    }

    // Reload map periodically (every 60s approx)
    if (Date.now() - lastMapUpdate > 60_000) {
      // logger.info('[poller] refreshing map...'); // Silenced
      try {
        const newMap = await loadMap(API_BASE, GROUP);
        if (newMap && newMap.length > 0) {
          mapa = newMap;
          // logger.info(`[poller] map refreshed (${mapa.length} telares)`); // Silenced
        }
      } catch (e) {
        logger.warn('[poller] map refresh failed:', e.message);
      }
      lastMapUpdate = Date.now();
    }

    // Periodic DB Sync (Sessions & Resets) - Every 5s
    if (Date.now() - (global.lastDbSync || 0) > 5000) {
      try {
        const rec = await pullRecovery(API_BASE);
        if (rec && Array.isArray(rec.data)) {
          persistence.syncFromDB(rec.data);
        }
        global.lastDbSync = Date.now();
      } catch (e) {
        // Throttled log for DB sync failure
        if (!global.lastDbError || Date.now() - global.lastDbError > 60000) {
          logger.warn(`[poller] DB sync failed: ${e.message}`);
          global.lastDbError = Date.now();
        }
      }
    }

    // EJECUCIÓN CON WORKER POOL (Non-blocking)
    // Esto evita que una máquina lenta bloquee a todo el lote.
    await runPool(mapa, CONC);

    const spent = Date.now() - startLoop;
    cyclesCount++;
    cyclesTimeAccum += spent;

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

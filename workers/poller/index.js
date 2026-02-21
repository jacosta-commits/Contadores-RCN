'use strict';

/**
 * Poller principal — Lee telares por Modbus y emite estado por WebSocket.
 *
 * Refactorizado con OOP:
 *   - TelarCounter: estado encapsulado por telar
 *   - TelarRegistry: gestión de colección + persistencia
 */

const { setTimeout: delay } = require('timers/promises');
const logger = require('../../server/lib/logger');

const env = process.env;

const { loadMap } = require('./map.loader');
const { readPLC, readPulse } = require('./modbus.reader');
const { pullRecovery } = require('./cache.sync');
const { initSockets, emitTelarState, emitSupervisorState } = require('./broadcast');
const registry = require('./telar-registry');

const API_BASE = env.API_BASE || `http://127.0.0.1:${env.PORT || 8080}/api/v1`;
const WS_URL = env.WS_URL || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}`;
const GROUP = env.POLLER_GROUP || null;
const PERIOD_MS = parseInt(env.POLLER_PERIOD_MS, 10) || 1000;
const CONC = parseInt(env.POLLER_CONCURRENCY, 10) || 5;
const JITTER = parseInt(env.POLLER_JITTER_MS, 10) || 0;
const PPR = parseInt(env.PULSES_PER_ROW, 10) || 10;

/**
 * Seed baselines from disk or DB recovery.
 */
async function primeBaselines() {
  // 1. Try disk (fast)
  const diskCount = registry.loadFromDisk();
  if (diskCount > 0) {
    logger.info(`[poller] baselines loaded from disk (${diskCount})`);
    return;
  }

  // 2. Fallback to DB (slow, retry loop)
  let attempts = 0;
  while (true) {
    try {
      attempts++;
      const rec = await pullRecovery(API_BASE);
      registry.loadFromDB(rec);
      logger.info(`[poller] baselines loaded from DB (${rec.length})`);
      break;
    } catch (e) {
      logger.warn(`[poller] baselines fail (attempt ${attempts}): ${e.message}`);
      await delay(2000);
    }
  }
}

/**
 * Single telar cycle: read → process → sync → broadcast.
 */
async function cycle(telar, mapa) {
  // Backoff: skip if failed recently
  if (telar.nextRetry && Date.now() < telar.nextRetry) return;

  const ts = new Date();

  try {
    const counter = registry.get(telar.telarKey, telar.mode);
    let snapshot;

    if (telar.mode === 'PLC') {
      // PLC: inject hil_start for offset calculation
      telar.hil_start = counter.hil_start;
      const plcData = await readPLC(telar);
      snapshot = counter.processPLC(plcData);
    } else {
      // CALC: pulse-based delta accumulation
      const pulse = await readPulse(telar);
      snapshot = counter.processPulse(pulse, telar);
    }

    // DB sync (throttled per telar, write-behind)
    const srvData = await registry.syncToDB(counter, telar);

    // If server returned data, check for divergence
    if (srvData) {
      const srv = counter.getServerState();

      // Sync hil_start if diverged (shift reset from Supervisor)
      if (srv.hil_start !== undefined && srv.hil_start !== counter.hil_start) {
        logger.debug(`[poller] SYNC: hil_start diverged (local=${counter.hil_start}, server=${srv.hil_start})`);
        counter.seed({ hil_start: srv.hil_start });
        if (telar.mode !== 'PLC') {
          counter.hil_turno = Math.max(0, counter.hil_act - srv.hil_start);
        }
      }

      // Sync set_value
      if (srv.set_value !== undefined && srv.set_value !== counter.set_value) {
        counter.set_value = srv.set_value;
      }

      // Sync hil_acum_offset → update telar map
      if (srv.hil_acum_offset !== undefined && srv.hil_acum_offset !== (telar.hil_acum_offset || 0)) {
        telar.hil_acum_offset = srv.hil_acum_offset;
      }
    }

    // Rebuild snapshot after potential sync changes
    snapshot = counter.toSnapshot();

    // Disk persistence (throttled globally)
    registry.saveToDisk();

    // Broadcast to WS
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

    // Clear backoff on success
    if (telar.nextRetry) telar.nextRetry = 0;

  } catch (err) {
    logger.warn(`[poller] cycle failed telar=${telar.telarKey} (${telar.mode}): ${err.message}`);
    telar.nextRetry = Date.now() + 10000;
  }
}

async function main() {
  logger.info(`[poller] start → group=${GROUP || '(all)'} period=${PERIOD_MS}ms conc=${CONC} PPR=${PPR}`);
  await initSockets(WS_URL);

  // Load telar map
  let mapa = [];
  while (true) {
    try {
      mapa = await loadMap(API_BASE, GROUP);
      if (mapa.length > 0) {
        logger.info(`[poller] map loaded: ${mapa.length} telares`);
        break;
      }
      logger.warn('[poller] empty map, retrying in 5s...');
    } catch (e) {
      logger.warn(`[poller] map load failed: ${e.message}. Retrying in 5s...`);
    }
    await delay(5000);
  }

  // Load baselines (disk or DB)
  await primeBaselines();

  // Subscribe bridge events (with access to mapa for map updates)
  registry.subscribeBridge((telcod) => mapa.find(m => m.telarKey === telcod));

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

          if (JITTER > 0) await delay(Math.random() * JITTER);

          const startCycle = Date.now();
          await cycle(telar, mapa);
          const duration = Date.now() - startCycle;

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
      logger.info(`[poller] HEARTBEAT: ${cyclesCount} loops/min. Avg: ${avg}ms. Map: ${mapa.length}. Registry: ${registry.size}`);
      cyclesCount = 0;
      cyclesTimeAccum = 0;
      lastHeartbeat = Date.now();
    }

    // Reload map periodically (every 60s)
    if (Date.now() - lastMapUpdate > 60_000) {
      try {
        const newMap = await loadMap(API_BASE, GROUP);
        if (newMap && newMap.length > 0) {
          mapa = newMap;
        }
      } catch (e) {
        logger.warn('[poller] map refresh failed:', e.message);
      }
      lastMapUpdate = Date.now();
    }

    // Periodic DB Sync (Sessions & Resets) — safety net; bridge handles instant updates
    if (Date.now() - (global.lastDbSync || 0) > 3000) {
      try {
        const rec = await pullRecovery(API_BASE);
        const items = Array.isArray(rec) ? rec : (rec?.data || []);
        if (items.length > 0) {
          registry.syncFromDB(items);
        }
        global.lastDbSync = Date.now();
      } catch (e) {
        if (!global.lastDbError || Date.now() - global.lastDbError > 60000) {
          logger.warn(`[poller] DB sync failed: ${e.message}`);
          global.lastDbError = Date.now();
        }
      }
    }

    // Execute worker pool
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

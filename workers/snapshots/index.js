'use strict';

/**
 * Cada N segundos lee la caché y escribe PERIODIC en RCN_CONT_LECTURA.
 * API:
 *  - GET  /api/v1/cache/recovery
 *  - POST /api/v1/lecturas/periodic
 */

const { setTimeout: delay } = require('timers/promises');
const env = require('../../server/lib/env');
const logger = require('../../server/lib/logger');

const { pullRecovery } = require('../poller/cache.sync');

const _fetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

const API_BASE = env.API_BASE || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}/api/v1`;
const EVERY_MS = Number(env.SNAPSHOT_EVERY_MS || 60_000);

async function writePeriodic(r) {
  // r proviene de VW_RCN_CONT_RECOVERY
  const body = {
    sescod: r.session_active ? r.sescod : null,
    telcod: r.telcod,
    ts: new Date().toISOString(),
    hil_act: r.hil_act,
    hil_turno: r.hil_turno,
    hil_start: r.hil_start,
    set_value: r.set_value,
    tracod: null,
  };

  const res = await _fetch(`${API_BASE}/lecturas/periodic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`periodic HTTP ${res.status} ${t}`);
  }
}

async function main() {
  logger.info(`[snapshots] iniciado, cada ${EVERY_MS} ms`);
  for (;;) {
    const tic = Date.now();
    try {
      const rec = await pullRecovery(API_BASE);
      await Promise.allSettled(rec.map(writePeriodic));
      logger.debug(`[snapshots] escritos PERIODIC=${rec.length}`);
    } catch (e) {
      logger.warn('[snapshots] error:', e.message);
    }
    const spent = Date.now() - tic;
    const rest = Math.max(0, EVERY_MS - spent);
    if (rest > 0) await delay(rest);
  }
}

if (require.main === module) {
  main().catch((e) => {
    logger.error('[snapshots] crash:', e);
    process.exit(1);
  });
}

module.exports = { main };

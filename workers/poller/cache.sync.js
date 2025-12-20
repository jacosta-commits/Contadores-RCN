'use strict';

/**
 * Sincroniza caché para recuperación (VW_RCN_CONT_RECOVERY)
 * API:
 *  - GET  /api/v1/cache/recovery
 *  - PUT  /api/v1/cache (body en cache.controller.js)
 */

const _fetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

async function pullRecovery(API_BASE) {
  const res = await _fetch(`${API_BASE}/cache/recovery`);
  if (!res.ok) throw new Error(`recovery HTTP ${res.status}`);
  const json = await res.json();
  return json?.data || [];
}

async function upsertCache(API_BASE, body) {
  const res = await _fetch(`${API_BASE}/cache`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`cache upsert HTTP ${res.status} ${txt}`);
  }
  return res.json().catch(() => ({}));
}

module.exports = { pullRecovery, upsertCache };

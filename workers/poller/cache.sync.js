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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await _fetch(`${API_BASE}/cache/recovery`, { signal: controller.signal });
    if (!res.ok) throw new Error(`recovery HTTP ${res.status}`);
    const json = await res.json();
    return json?.data || [];
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertCache(API_BASE, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await _fetch(`${API_BASE}/cache`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`cache upsert HTTP ${res.status} ${txt}`);
    }
    return res.json().catch(() => ({}));
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { pullRecovery, upsertCache };

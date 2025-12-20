'use strict';

/**
 * Carga la vista VW_RCN_CONT_TELAR_MAP desde API v1/telares
 */

const logger = require('../../server/lib/logger');

// fetch nativo si existe; fallback a node-fetch dinámico
const _fetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

async function loadMap(API_BASE, grupo = null) {
  const url = new URL(`${API_BASE}/telares`);
  if (grupo) url.searchParams.set('grupo', grupo);
  url.searchParams.set('activos', 'true');
  url.searchParams.set('view', 'map');

  const res = await _fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`loadMap HTTP ${res.status}`);
  }

  const json = await res.json();
  const data = json?.data || [];
  if (data.length > 0) {
    logger.info(`[map.loader] First item: ${JSON.stringify(data[0])}`);
  } else {
    logger.warn('[map.loader] Received empty data array');
  }

  // Normaliza nombres esperados por poller/modbus
  const mapa = data.map((r) => ({
    telarKey: r.telarKey,
    sqlTelar: r.sqlTelar,
    telnom: r.telnom,
    grupo: r.grupo,
    modbusIP: r.modbusIP,
    modbusPort: r.modbusPort || 502,
    modbusID: r.modbusID || 1,
    holdingOffset: r.holdingOffset,
    mode: r.mode, // 'PLC' | 'CALC'
    coilReset: r.coilReset ?? null,
    coilFinTurno: r.coilFinTurno ?? null,
    activo: !!r.activo,
  }));

  logger.info(`[map.loader] recibidos ${mapa.length} registros`);
  // Filtrar telar 0069 temporalmente para evitar lag por timeouts
  return mapa.filter(t => t.telarKey !== '0069');
}

module.exports = { loadMap };

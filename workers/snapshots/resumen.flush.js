'use strict';

/**
 * (Opcional) Cierres diferidos o tareas de resumen fin de turno.
 * Aquí solo dejamos un esqueleto: si necesitas automatizar FIN_TURNO,
 * puedes consultar sesiones activas y disparar /lecturas/fin cuando toque.
 */

const env = require('../../server/lib/env');
const logger = require('../../server/lib/logger');

const _fetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

const API_BASE = env.API_BASE || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 8080}/api/v1`;

async function flushFinTurno(/* params */) {
  // Ejemplo: POST /lecturas/fin por cada (sescod, telcod) pendiente
  // await _fetch(`${API_BASE}/lecturas/fin`, { method:'POST', body: JSON.stringify({...}) });
  logger.info('[flush] (stub) nada que hacer por ahora');
}

module.exports = { flushFinTurno };

'use strict';

const logger = require('../lib/logger').child({ mod: 'cache.service' });
const cacheDAL = require('../dal/cache.dal');

/** Upsert de snapshot en CACHE (para recovery y stream) */
async function upsert(payload) {
  // VALIDACIÓN DE SESIÓN:
  // Si el Poller dice que hay sesión activa, verificamos contra la DB.
  // Si la DB dice que NO está activa (o es otra), forzamos corrección.
  if (payload.session_active && payload.telcod) {
    try {
      const stDAL = require('../dal/sesion-telar.dal');
      const ocupacion = await stDAL.getOcupacionActual({ telcod: payload.telcod });

      // Si no hay ocupación real, o la sesión no coincide
      if (!ocupacion || (payload.sescod && String(ocupacion.sescod) !== String(payload.sescod))) {
        // FORZAR CIERRE EN EL PAYLOAD QUE SE GUARDARÁ Y DEVOLVERÁ
        payload.session_active = 0;
        payload.hil_turno = 0;
        payload.hil_start = payload.hil_act; // Reset base
        payload.sescod = null;
        payload.tracod = null;
        payload.traraz = null;
        payload.turno_cod = null;

        logger.info({ telcod: payload.telcod }, 'Corrección forzada: sesión inactiva en DB, reseteando payload del Poller');
      }
    } catch (e) {
      logger.warn({ e }, 'Error validando sesión en upsert cache');
    }
  }

  // PROTECCIÓN RESET ELIMINADA
  // La protección bloqueaba valores válidos post-reset creando un bucle infinito.
  // La sincronización correcta se maneja en el poller.

  return cacheDAL.upsert(payload);
}

/** Snapshot completo de recovery (p/ levantar tras reinicio) */
async function getRecovery() {
  return cacheDAL.getRecovery();
}

module.exports = { upsert, getRecovery };

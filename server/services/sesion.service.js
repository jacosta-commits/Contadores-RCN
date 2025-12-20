'use strict';

const logger = require('../lib/logger').child({ mod: 'sesion.service' });
const sesionesDAL = require('../dal/sesiones.dal');
const turnosDAL = require('../dal/turnos.dal');
const stDAL = require('../dal/sesion-telar.dal');

/** Abre sesión; si no mandan turno_cod, se resuelve con la hora actual */
async function abrir({ tracod, traraz = null, turno_cod = null, dev_uuid = null, ip_origen = null, user_agent = null, inicio = null }) {
  let t = turno_cod;
  if (!t) t = await turnosDAL.getActual(new Date());
  if (!tracod) throw new Error('tracod requerido');

  const row = await sesionesDAL.abrir({
    tracod, traraz, turno_cod: t, dev_uuid, ip_origen, user_agent, inicio,
  });
  return row;
}

/** Cierra sesión por id */
async function cerrar({ sescod, fin = null }) {
  logger.info({ sescod }, '[cerrar] Iniciando cierre de sesión');

  // 1. Obtener telares activos de esta sesión
  const activos = await stDAL.listActivos({ sescod });
  logger.info({ sescod, activos }, `[cerrar] Telares activos: ${activos.length}`);

  // 2. Para cada telar activo, leer su estado actual del cache
  const cacheDAL = require('../dal/cache.dal'); // Lazy require
  const lecturaSvc = require('./lectura.service'); // Lazy require para evitar ciclos si hubiera

  for (const t of activos) {
    try {
      // Leer estado actual del telar desde el cache
      const cacheState = await cacheDAL.getByTelcod(t.telcod);
      logger.info({ telcod: t.telcod, cacheState }, '[cerrar] Estado del cache antes de FIN');

      if (cacheState) {
        // Registrar FIN con los valores actuales del cache
        await lecturaSvc.registrarFin({
          sescod,
          telcod: t.telcod,
          ts: fin || new Date(),
          hil_act: cacheState.hil_act,
          hil_turno: cacheState.hil_turno,
          hil_start: cacheState.hil_start,
          set_value: cacheState.set_value,
          tracod: cacheState.tracod
        });
        logger.info({ telcod: t.telcod }, '[cerrar] FIN_TURNO registrado');
      } else {
        logger.warn({ telcod: t.telcod }, 'Telar no encontrado en cache al cerrar sesión');
      }

      // IMPORTANTE: Desasignar el telar (marcar activo=0 en RCN_CONT_SESION_TELAR)
      // Usamos el servicio para que dispare la lógica de reset de hil_turno y WS
      const sesionTelarSvc = require('./sesion-telar.service');
      await sesionTelarSvc.quitar({ sescod, telcod: t.telcod });
      logger.info({ telcod: t.telcod }, '[cerrar] Telar desasignado y turno reseteado');

    } catch (e) {
      logger.warn({ e, telcod: t.telcod }, 'Error cerrando telar al cerrar sesión');
    }
  }

  // 2.5 Cancelar llamadas pendientes (tickets abiertos)
  try {
    const llamadasDAL = require('../dal/llamadas.dal');
    const cancelled = await llamadasDAL.cancelarPendientesPorSesion(sescod);
    if (cancelled.length > 0) {
      logger.info({ sescod, count: cancelled.length }, '[cerrar] Llamadas pendientes anuladas automáticamente');
    }
  } catch (e) {
    logger.warn({ e, sescod }, 'Error anulando llamadas pendientes al cerrar sesión');
  }

  // 3. Cerrar la sesión en sí
  logger.info({ sescod }, '[cerrar] Cerrando sesión en BD');
  return sesionesDAL.cerrar({ sescod, fin });
}

/** Detalle de sesión */
async function getById(sescod) {
  return sesionesDAL.getById(sescod);
}

/** (opcional) fija JTI activo si luego manejas JWT por dispositivo */
async function setActiveJti({ sescod, jti }) {
  return sesionesDAL.setActiveJti({ sescod, jti });
}

module.exports = { abrir, cerrar, getById, setActiveJti };

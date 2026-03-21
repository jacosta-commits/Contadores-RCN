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
  let activos = [];
  try {
    activos = await stDAL.listActivos({ sescod });
    logger.info({ sescod, activos }, `[cerrar] Telares activos: ${activos.length}`);
  } catch (e) {
    logger.warn({ e, sescod }, '[cerrar] Error listando telares activos - continuando con cierre');
  }

  // 2. Para cada telar activo, leer su estado actual del cache (EN PARALELO)
  const cacheDAL = require('../dal/cache.dal');
  const lecturaSvc = require('./lectura.service');
  const sesionTelarSvc = require('./sesion-telar.service');

  await Promise.all(activos.map(async (t) => {
    try {
      const cacheState = await cacheDAL.getByTelcod(t.telcod);
      logger.info({ telcod: t.telcod, cacheState }, '[cerrar] Estado del cache antes de FIN');

      if (cacheState) {
        await lecturaSvc.registrarFin({
          sescod,
          telcod: t.telcod,
          ts: fin || new Date(),
          hil_act: cacheState.hil_act,
          hil_turno: cacheState.hil_turno,
          hil_start: cacheState.hil_act,  // CORREGIDO: guardar hil_act como nuevo hil_start (valor actualizado post-cierre)
          set_value: cacheState.set_value,
          tracod: cacheState.tracod
        });
        logger.info({ telcod: t.telcod }, '[cerrar] FIN_TURNO registrado');
      } else {
        logger.warn({ telcod: t.telcod }, 'Telar no encontrado en cache al cerrar sesión');
      }

      await sesionTelarSvc.quitar({ sescod, telcod: t.telcod });
      logger.info({ telcod: t.telcod }, '[cerrar] Telar desasignado y turno reseteado');

    } catch (e) {
      logger.warn({ e, telcod: t.telcod }, 'Error cerrando telar al cerrar sesión');
    }
  }));

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

  // 3. CRÍTICO: Cerrar la sesión en sí — SIEMPRE debe ejecutarse
  // aunque los pasos anteriores fallen, para evitar sesiones "fantasma"
  let res;
  try {
    logger.info({ sescod }, '[cerrar] Cerrando sesión en BD');
    res = await sesionesDAL.cerrar({ sescod, fin });
  } catch (e) {
    logger.error({ e, sescod }, '[cerrar] ERROR CRÍTICO cerrando sesión en BD. Intentando forzar cierre...');
    // Fallback: intentar cerrar de todas formas directamente
    try {
      const { query: dbQuery, sql: dbSql } = require('../dal/db');
      await dbQuery(`
        UPDATE dbo.RCN_CONT_SESION SET activo = 0, estado = 'F', fin = @fin WHERE sescod = @sescod
      `, req => {
        req.input('sescod', dbSql.BigInt, sescod);
        req.input('fin', dbSql.DateTime2, fin || new Date());
      });
      logger.info({ sescod }, '[cerrar] Sesión cerrada vía fallback directo');
    } catch (fallbackErr) {
      logger.error({ fallbackErr, sescod }, '[cerrar] FALLBACK TAMBIÉN FALLÓ — sesión puede quedar abierta');
    }
  }

  // 4. Emitir evento global para que las tablets reaccionen
  try {
    const bus = require('../lib/poller-bridge');
    bus.emit('sesion.cerrada', { sescod });
  } catch (e) {
    logger.warn({ e, sescod }, '[cerrar] Error emitiendo evento sesion.cerrada');
  }

  return res;
}

/** Detalle de sesión */
async function getById(sescod) {
  return sesionesDAL.getById(sescod);
}

/** Cierra automáticamente sesiones que hayan superado su tiempo límite */
async function cerrarExpiradas() {
  try {
    const expiradas = await sesionesDAL.getExpiradas();
    if (expiradas.length > 0) {
      logger.info(`[cerrarExpiradas] Encontradas ${expiradas.length} sesiones expiradas para cerrar.`);
      for (const sesion of expiradas) {
        logger.info({ sescod: sesion.sescod, tracod: sesion.tracod }, '[cerrarExpiradas] Cerrando sesión automáticamente por tiempo');
        await cerrar({ sescod: sesion.sescod });
      }
    }
  } catch (err) {
    logger.error({ err }, '[cerrarExpiradas] Error al procesar sesiones expiradas');
  }
}

/** (opcional) fija JTI activo si luego manejas JWT por dispositivo */
async function setActiveJti({ sescod, jti }) {
  return sesionesDAL.setActiveJti({ sescod, jti });
}

module.exports = { abrir, cerrar, getById, setActiveJti, cerrarExpiradas };

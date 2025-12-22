'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger').child({ mod: 'sesion-telar.service' });
const stDAL = require('../dal/sesion-telar.dal');

/** Asigna telar a sesión (idempotente; índices/trigger validan reglas) */
async function asignar({ sescod, telcod }) {
  try {
    // 1. Asignar el telar a la sesión
    const assignment = await stDAL.asignar({ sescod, telcod });

    // 2. Obtener el estado actual del telar desde el cache
    const cacheDAL = require('../dal/cache.dal');
    const cacheState = await cacheDAL.getByTelcod(telcod);

    // 3. Registrar INICIO_TURNO automáticamente con el snapshot actual
    // (No tocamos hil_start al iniciar, solo al cerrar)
    const lecturaSvc = require('./lectura.service');
    await lecturaSvc.registrarInicio({
      sescod,
      telcod,
      ts: new Date(),
      hil_act: cacheState?.hil_act ?? 0,
      hil_turno: cacheState?.hil_turno ?? 0,
      hil_start: cacheState?.hil_start ?? 0,
      set_value: cacheState?.set_value ?? 0,
      tracod: cacheState?.tracod ?? null
    });

    // 3b. CRÍTICO: Actualizar RCN_CONT_CACHE con la nueva sesión
    // para que el poller (y Supervisor) vean quién está trabajando.
    // Necesitamos obtener los datos de la sesión primero.
    const sesionDAL = require('../dal/sesiones.dal');
    const sesionInfo = await sesionDAL.getById(sescod);

    if (sesionInfo) {
      await cacheDAL.upsert({
        telcod,
        sescod,
        tracod: sesionInfo.tracod,
        traraz: sesionInfo.traraz,
        turno_cod: sesionInfo.turno_cod,
        session_active: 1,
        // Preservar contadores actuales
        hil_act: cacheState?.hil_act ?? 0,
        hil_turno: cacheState?.hil_turno ?? 0,
        hil_start: cacheState?.hil_start ?? 0,
        set_value: cacheState?.set_value ?? 0,
        velocidad: cacheState?.velocidad ?? 0
      });
    }

    // 4. Emitir actualización por WebSocket para que Supervisor lo vea inmediatamente
    try {
      const { bus } = require('../sockets');
      bus.telar.state(telcod, {
        telcod,
        sescod,
        session_active: 1,
        hil_act: cacheState?.hil_act ?? 0,
        hil_turno: cacheState?.hil_turno ?? 0,
        hil_start: cacheState?.hil_start ?? 0,
        set_value: cacheState?.set_value ?? 0,
        tracod: sesionInfo?.tracod ?? null,
        traraz: sesionInfo?.traraz ?? null,
        turno_cod: sesionInfo?.turno_cod ?? null,
        velocidad: 0
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'Error emitiendo WS en asignar telar');
    }

    logger.info({ sescod, telcod }, 'Telar asignado con snapshot INICIO_TURNO');
    return assignment;

  } catch (err) {
    // Mapear violación de índice único "telar ocupado" a 409 Conflict
    const num = err?.number ?? err?.originalError?.info?.number;
    const msg = String(err?.message || err?.originalError?.message || '');

    const isUnique =
      num === 2627 || num === 2601 || msg.includes('UQ_RCN_CONT_TELAR_OCUPADO');

    if (isUnique) {
      let occ = null;
      try { occ = await stDAL.getOcupacionActual({ telcod }); } catch (_) { }
      const sesOcupadora = occ?.sescod ?? '(desconocida)';
      throw new HttpError(
        409,
        `El telar ${telcod} ya está asignado a la sesión ${sesOcupadora}.`,
        { telcod, ocupacion: occ }
      );
    }

    throw err;
  }
}

/** Quita (desactiva) telar de sesión */
async function quitar({ sescod, telcod }) {
  const result = await stDAL.quitar({ sescod, telcod });

  // Obtener estado actual para resetear hil_turno
  const cacheDAL = require('../dal/cache.dal');
  const current = await cacheDAL.getByTelcod(telcod);

  // Resetear hil_turno: hil_start = hil_act
  const newHilStart = current?.hil_act || 0;

  logger.info({ telcod, current_hil_act: current?.hil_act, newHilStart }, 'Cerrando sesión: actualizando hil_start para resetear turno');

  if (current) {
    await cacheDAL.upsert({
      ...current,
      hil_start: newHilStart,
      hil_act: current?.hil_act ?? 0,
      session_active: 0,
      sescod: null,
      set_value: undefined // Forzar UPDATE directo (bypass SP) para proteger hil_act
    });
  }

  // Emitir actualización por WebSocket
  try {
    const { bus } = require('../sockets');
    bus.telar.state(telcod, {
      telcod,
      session_active: 0,
      sescod: null,
      hil_start: newHilStart,
      hil_act: current?.hil_act || 0, // ENVIAR HIL_ACT EXPLICITAMENTE
      hil_turno: 0 // Visualmente 0 inmediato
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'Error emitiendo WS en quitar telar');
  }

  return result;
}

/** Lista de telares activos por sesión */
async function listActivos({ sescod }) {
  return stDAL.listActivos({ sescod });
}

module.exports = { asignar, quitar, listActivos };

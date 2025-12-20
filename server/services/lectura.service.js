'use strict';

const logger = require('../lib/logger').child({ mod: 'lectura.service' });
const lecDAL = require('../dal/lecturas.dal');
const cacheSvc = require('./cache.service');

/** INICIO_TURNO (idempotente vía SP) */
async function registrarInicio(p) {
  const row = await lecDAL.registrarInicio(p);

  // Marcar sesión activa y persistir estado/offset para recovery
  try {
    await cacheSvc.upsert({
      telcod: p.telcod,
      sescod: p.sescod,
      tracod: p.tracod ?? null,
      traraz: null,
      turno_cod: null,
      session_active: 1,
      hil_act: p.hil_act ?? 0,
      hil_turno: p.hil_turno ?? 0,
      hil_start: p.hil_start ?? 0,
      set_value: p.set_value ?? 0,
      velocidad: 0,
    });
  } catch (e) {
    logger.warn({ e }, 'cache upsert (inicio) falló');
  }

  return row;
}

/** FIN_TURNO (idempotente vía SP) */
async function registrarFin(p) {
  const row = await lecDAL.registrarFin(p);

  // Preparar siguiente turno: offset = hil_act; hil_turno = 0; sesión inactiva
  // COMENTADO: Ya lo hace sesion-telar.service.js con lógica más robusta y WS
  /*
  try {
    await cacheSvc.upsert({
      telcod: p.telcod,
      sescod: null,
      session_active: 0,
      hil_act:   p.hil_act   ?? 0,
      hil_turno: 0,
      hil_start: p.hil_act   ?? 0,
      set_value: p.set_value ?? 0,
      velocidad: 0,
    });
  } catch (e) {
    logger.warn({ e }, 'cache upsert (fin) falló');
  }
  */

  return row;
}

/** PERIODIC */
async function registrarPeriodic(p) {
  return lecDAL.registrarPeriodic(p);
}

/** MANUAL */
async function registrarManual(p) {
  return lecDAL.registrarManual(p);
}

/** Listado por telar con rango/límite opcional */
async function listPorTelar({ telcod, from = null, to = null, limit = 200 }) {
  return lecDAL.listPorTelar({ telcod, from, to, limit });
}

/** Listado por sesión */
async function listPorSesion({ sescod }) {
  return lecDAL.listPorSesion({ sescod });
}

module.exports = {
  registrarInicio,
  registrarFin,
  registrarPeriodic,
  registrarManual,
  listPorTelar,
  listPorSesion,
};

'use strict';

const logger = require('../lib/logger').child({ mod: 'turno.service' });
const turnosDAL = require('../dal/turnos.dal');

/** Catálogo de turnos activos */
async function getCatalogo() {
  return turnosDAL.getCatalogo();
}

/** Turno actual para un datetime dado (o ahora) */
async function getActual(dt = new Date()) {
  const turno_cod = await turnosDAL.getActual(dt);
  return { turno_cod, at: dt };
}

/** Ventana [inicio_dt, fin_dt) para fecha base (solo fecha) y turno */
async function getRango(baseDate = new Date(), turno_cod) {
  if (!turno_cod) throw new Error('turno_cod requerido');
  const rango = await turnosDAL.getRango(baseDate, turno_cod);
  if (!rango) return null;
  return { turno_cod, ...rango };
}

module.exports = { getCatalogo, getActual, getRango };

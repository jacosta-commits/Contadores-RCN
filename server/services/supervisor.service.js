'use strict';

const logger = require('../lib/logger').child({ mod: 'supervisor.service' });
const turnosDAL = require('../dal/turnos.dal');
const reportesDAL = require('../dal/reportes.dal');

/**
 * KPIs por grupo y ventana de turno.
 * Si no se pasa turno_cod, se usa el turno actual.
 */
async function getKPIs({ grupo = null, turno_cod = null, base_date = new Date() } = {}) {
  let t = turno_cod;
  if (!t) t = await turnosDAL.getActual(base_date);

  const rango = await turnosDAL.getRango(base_date, t);
  if (!rango) {
    return { turno_cod: t, inicio_dt: null, fin_dt: null, kpis: null, ventana_min: null };
  }

  const { inicio_dt, fin_dt } = rango;
  const kpis = await reportesDAL.getKPIsByGrupoVentana({ grupo, inicio_dt, fin_dt });
  const ventana_min = Math.max(0, Math.round((new Date(fin_dt) - new Date(inicio_dt)) / 60000));

  return { turno_cod: t, inicio_dt, fin_dt, ventana_min, kpis };
}

/** Resumen INICIO/FIN por sesión y/o telar (vista de reporte) */
async function getResumenSesionTelar({ sescod = null, telcod = null } = {}) {
  return reportesDAL.getResumenSesionTelar({ sescod, telcod });
}

module.exports = { getKPIs, getResumenSesionTelar };

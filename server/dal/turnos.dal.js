'use strict';

const { sql, query } = require('./db');

/** Catálogo de turnos activos */
async function getCatalogo() {
  const rs = await query(`
    SELECT turno_cod, hora_ini, hora_fin, descripcion, activo, cruza_dia
    FROM dbo.RCN_CONT_TURNO
    WHERE activo = 1
    ORDER BY turno_cod
  `);
  return rs.recordset;
}

/** Turno actual (usa fn_rcn_cont_turno_actual) */
async function getActual(dt) {
  const rs = await query(`
    SELECT dbo.fn_rcn_cont_turno_actual(@dt) AS turno_cod
  `, req => {
    req.input('dt', sql.DateTime2, dt);
  });
  return rs.recordset[0]?.turno_cod || null;
}

/** Ventana [inicio_dt, fin_dt) de un turno para fecha base (fn_rcn_cont_rango_turno) */
async function getRango(baseDate, turnoCod) {
  const rs = await query(`
    SELECT inicio_dt, fin_dt
    FROM dbo.fn_rcn_cont_rango_turno(@base_date, @turno_cod)
  `, req => {
    req.input('base_date', sql.Date, baseDate);
    req.input('turno_cod', sql.Char(1), turnoCod);
  });
  return rs.recordset[0] || null;
}

module.exports = {
  getCatalogo,
  getActual,
  getRango,
};

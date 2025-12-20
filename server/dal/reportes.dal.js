'use strict';

const { sql, query } = require('./db');

/**
 * Resumen INICIO/FIN por sesión y/o telar (vista VW_RCN_CONT_RESUMEN_SESION_TELAR)
 */
async function getResumenSesionTelar({ sescod = null, telcod = null } = {}) {
  let q = `
    SELECT s.sescod, s.telcod,
           ts_inicio, ts_fin,
           hil_act_ini, hil_act_fin,
           hil_turno_ini, hil_turno_fin,
           hil_start_ini, hil_start_fin,
           set_value_ini, set_value_fin,
           hileras_turno, avance_act, meta_lote
    FROM dbo.VW_RCN_CONT_RESUMEN_SESION_TELAR s
    WHERE 1=1
  `;
  const params = [];
  if (sescod !== null) { q += ` AND s.sescod = @sescod`; params.push(['sescod', sql.BigInt, sescod]); }
  if (telcod) { q += ` AND s.telcod = @telcod`; params.push(['telcod', sql.VarChar(10), telcod]); }
  q += ` ORDER BY s.sescod DESC, s.telcod ASC`;

  const rs = await query(q, req => {
    params.forEach(([n,t,v]) => req.input(n,t,v));
  });
  return rs.recordset;
}

/**
 * KPIs por grupo y ventana de turno: suma/avg básicas sobre resumen.
 * Devuelve:
 *  - total_telares, con_inicio, con_fin
 *  - sum_hileras_turno, avg_hileras_turno
 *  - sum_avance_act,   avg_avance_act
 */
async function getKPIsByGrupoVentana({ grupo = null, inicio_dt, fin_dt }) {
  // Usamos la vista de resumen + join a TELAR para filtrar por grupo
  const rs = await query(`
    WITH base AS (
      SELECT r.*, t.grupo
      FROM dbo.VW_RCN_CONT_RESUMEN_SESION_TELAR r
      INNER JOIN dbo.RCN_CONT_TELAR t ON t.telcod = r.telcod
      WHERE (@grupo IS NULL OR t.grupo = @grupo)
        AND (
          (r.ts_inicio IS NOT NULL AND r.ts_inicio >= @ini AND r.ts_inicio < @fin)
          OR
          (r.ts_fin    IS NOT NULL AND r.ts_fin    >= @ini AND r.ts_fin    < @fin)
        )
    )
    SELECT
      COUNT(DISTINCT telcod)          AS total_telares,
      SUM(CASE WHEN ts_inicio IS NOT NULL THEN 1 ELSE 0 END) AS con_inicio,
      SUM(CASE WHEN ts_fin IS NOT NULL THEN 1 ELSE 0 END)    AS con_fin,
      SUM(COALESCE(hileras_turno,0)) AS sum_hileras_turno,
      AVG(NULLIF(hileras_turno,0))   AS avg_hileras_turno,
      SUM(COALESCE(avance_act,0))    AS sum_avance_act,
      AVG(NULLIF(avance_act,0))      AS avg_avance_act
    FROM base
  `, req => {
    req.input('grupo', sql.VarChar(40), grupo);
    req.input('ini', sql.DateTime2, inicio_dt);
    req.input('fin', sql.DateTime2, fin_dt);
  });

  return rs.recordset[0] || {
    total_telares: 0, con_inicio: 0, con_fin: 0,
    sum_hileras_turno: 0, avg_hileras_turno: null,
    sum_avance_act: 0, avg_avance_act: null,
  };
}

module.exports = {
  getResumenSesionTelar,
  getKPIsByGrupoVentana,
};

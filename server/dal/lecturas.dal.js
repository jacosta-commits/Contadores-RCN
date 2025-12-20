'use strict';

const { sql, query } = require('./db');

/** Ejecuta SP de INICIO_TURNO (idempotente) y retorna la fila resultante */
async function registrarInicio({ sescod, telcod, ts = null, hil_act = null, hil_turno = null, hil_start = null, set_value = null, tracod = null }) {
  await query(`
    EXEC dbo.sp_rcn_cont_registrar_inicio
      @sescod=@p_sescod, @telcod=@p_telcod, @ts=@p_ts,
      @hil_act=@p_hil_act, @hil_turno=@p_hil_turno, @hil_start=@p_hil_start,
      @set_value=@p_set_value, @tracod=@p_tracod
  `, req => {
    req.input('p_sescod', sql.BigInt, sescod);
    req.input('p_telcod', sql.VarChar(10), telcod);
    req.input('p_ts', sql.DateTime2, ts);
    req.input('p_hil_act', sql.Int, hil_act);
    req.input('p_hil_turno', sql.Int, hil_turno);
    req.input('p_hil_start', sql.Int, hil_start);
    req.input('p_set_value', sql.Int, set_value);
    req.input('p_tracod', sql.VarChar(15), tracod);
  });

  const rs = await query(`
    SELECT TOP (1) *
    FROM dbo.RCN_CONT_LECTURA
    WHERE sescod=@sescod AND telcod=@telcod AND tipo='INICIO_TURNO'
    ORDER BY id DESC
  `, r => {
    r.input('sescod', sql.BigInt, sescod);
    r.input('telcod', sql.VarChar(10), telcod);
  });

  return rs.recordset[0] || null;
}

/** Ejecuta SP de FIN_TURNO (idempotente) */
async function registrarFin({ sescod, telcod, ts = null, hil_act = null, hil_turno = null, hil_start = null, set_value = null, tracod = null }) {
  await query(`
    EXEC dbo.sp_rcn_cont_registrar_fin
      @sescod=@p_sescod, @telcod=@p_telcod, @ts=@p_ts,
      @hil_act=@p_hil_act, @hil_turno=@p_hil_turno, @hil_start=@p_hil_start,
      @set_value=@p_set_value, @tracod=@p_tracod
  `, req => {
    req.input('p_sescod', sql.BigInt, sescod);
    req.input('p_telcod', sql.VarChar(10), telcod);
    req.input('p_ts', sql.DateTime2, ts);
    req.input('p_hil_act', sql.Int, hil_act);
    req.input('p_hil_turno', sql.Int, hil_turno);
    req.input('p_hil_start', sql.Int, hil_start);
    req.input('p_set_value', sql.Int, set_value);
    req.input('p_tracod', sql.VarChar(15), tracod);
  });

  const rs = await query(`
    SELECT TOP (1) *
    FROM dbo.RCN_CONT_LECTURA
    WHERE sescod=@sescod AND telcod=@telcod AND tipo='FIN_TURNO'
    ORDER BY id DESC
  `, r => {
    r.input('sescod', sql.BigInt, sescod);
    r.input('telcod', sql.VarChar(10), telcod);
  });

  return rs.recordset[0] || null;
}

/** Inserta PERIODIC */
async function registrarPeriodic({ sescod = null, telcod, ts = null, hil_act = null, hil_turno = null, hil_start = null, set_value = null, tracod = null }) {
  const rs = await query(`
    INSERT INTO dbo.RCN_CONT_LECTURA (sescod, telcod, ts, tipo, hil_act, hil_turno, hil_start, set_value, tracod)
    OUTPUT INSERTED.*
    VALUES (@sescod, @telcod, COALESCE(@ts, SYSDATETIME()), 'PERIODIC', @hil_act, @hil_turno, @hil_start, @set_value, @tracod)
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), telcod);
    req.input('ts', sql.DateTime2, ts);
    req.input('hil_act', sql.Int, hil_act);
    req.input('hil_turno', sql.Int, hil_turno);
    req.input('hil_start', sql.Int, hil_start);
    req.input('set_value', sql.Int, set_value);
    req.input('tracod', sql.VarChar(15), tracod);
  });
  return rs.recordset[0];
}

/** Inserta MANUAL */
async function registrarManual({ sescod = null, telcod, ts = null, hil_act = null, hil_turno = null, hil_start = null, set_value = null, tracod = null }) {
  const rs = await query(`
    INSERT INTO dbo.RCN_CONT_LECTURA (sescod, telcod, ts, tipo, hil_act, hil_turno, hil_start, set_value, tracod)
    OUTPUT INSERTED.*
    VALUES (@sescod, @telcod, COALESCE(@ts, SYSDATETIME()), 'MANUAL', @hil_act, @hil_turno, @hil_start, @set_value, @tracod)
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), telcod);
    req.input('ts', sql.DateTime2, ts);
    req.input('hil_act', sql.Int, hil_act);
    req.input('hil_turno', sql.Int, hil_turno);
    req.input('hil_start', sql.Int, hil_start);
    req.input('set_value', sql.Int, set_value);
    req.input('tracod', sql.VarChar(15), tracod);
  });
  return rs.recordset[0];
}

/** Lista lecturas por telar (con rango y límite opcional) */
async function listPorTelar({ telcod, from = null, to = null, limit = 200 }) {
  let q = `
    SELECT TOP (@lim)
      id, sescod, telcod, ts, tipo, hil_act, hil_turno, hil_start, set_value, tracod
    FROM dbo.RCN_CONT_LECTURA
    WHERE telcod = @telcod
  `;
  const params = [['telcod', sql.VarChar(10), telcod], ['lim', sql.Int, limit]];
  if (from) {
    q += ` AND ts >= @from`;
    params.push(['from', sql.DateTime2, from]);
  }
  if (to) {
    q += ` AND ts < @to`;
    params.push(['to', sql.DateTime2, to]);
  }
  q += ` ORDER BY ts DESC`;

  const rs = await query(q, req => {
    params.forEach(([n,t,v]) => req.input(n,t,v));
  });
  return rs.recordset;
}

/** Lista lecturas por sesión */
async function listPorSesion({ sescod }) {
  const rs = await query(`
    SELECT id, sescod, telcod, ts, tipo, hil_act, hil_turno, hil_start, set_value, tracod
    FROM dbo.RCN_CONT_LECTURA
    WHERE sescod = @sescod
    ORDER BY ts ASC
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
  });
  return rs.recordset;
}

module.exports = {
  registrarInicio,
  registrarFin,
  registrarPeriodic,
  registrarManual,
  listPorTelar,
  listPorSesion,
};

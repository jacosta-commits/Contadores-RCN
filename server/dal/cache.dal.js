'use strict';

const { sql, query } = require('./db');
const logger = require('../lib/logger');

/** Upsert a CACHE vía SP y devuelve snapshot de ese telar desde la vista */
async function upsert({
  telcod,
  sescod = null,
  tracod = null,
  traraz = null,
  turno_cod = null,
  session_active = 0,
  hil_act = 0,
  hil_turno = 0,
  hil_start = null,  // ← Ahora acepta null para NO sobrescribir
  set_value,         // ← SIN default para permitir undefined
  velocidad = 0,
}) {
  // Si hil_start es null/undefined, leer el valor actual del cache para NO sobrescribirlo
  let finalHilStart = hil_start;
  let finalSetValue = set_value;

  if (telcod === '0069') {
    logger.info({ telcod, hil_start, set_value }, '[cache.dal] Incoming upsert');
  }

  // Optimización: Si falta alguno, leemos DB una sola vez
  if ((finalHilStart === null || finalHilStart === undefined) || (finalSetValue === null || finalSetValue === undefined)) {
    const current = await query(`
      SELECT hil_start, set_value FROM dbo.RCN_CONT_CACHE WHERE telcod = @telcod
    `, r => r.input('telcod', sql.VarChar(10), telcod));

    const fetched = current.recordset[0] || {};

    if (finalHilStart === null || finalHilStart === undefined) {
      finalHilStart = fetched.hil_start ?? 0;
      logger.debug({ telcod, incoming: hil_start, final: finalHilStart }, '[cache.dal] Preserving hil_start');
    }

    if (finalSetValue === null || finalSetValue === undefined) {
      finalSetValue = fetched.set_value ?? 0;
      logger.debug({ telcod, incoming: set_value, final: finalSetValue }, '[cache.dal] Preserving set_value');
    }
  }

  // Si set_value es undefined, significa que el poller NO quiere modificarlo
  // En ese caso, hacemos UPDATE directo de solo los campos que cambian
  // para evitar que el SP lo resetee a 0
  if (set_value === null || set_value === undefined) {
    logger.debug({ telcod, incoming_set: set_value }, '[cache.dal] Using direct UPDATE to preserve set_value');
    await query(`
      UPDATE dbo.RCN_CONT_CACHE
      SET sescod = @sescod,
          tracod = @tracod,
          traraz = @traraz,
          turno_cod = @turno_cod,
          session_active = @session_active,
          hil_act = @hil_act,
          hil_turno = @hil_turno,
          hil_start = @hil_start,
          velocidad = @velocidad,
          updated_at = GETDATE()
      WHERE telcod = @telcod
    `, req => {
      req.input('telcod', sql.VarChar(10), telcod);
      req.input('sescod', sql.BigInt, sescod);
      req.input('tracod', sql.VarChar(15), tracod);
      req.input('traraz', sql.VarChar(120), traraz);
      req.input('turno_cod', sql.Char(1), turno_cod);
      req.input('session_active', sql.Bit, session_active ? 1 : 0);
      req.input('hil_act', sql.Int, hil_act);
      req.input('hil_turno', sql.Int, hil_turno);
      req.input('hil_start', sql.Int, finalHilStart);
      req.input('velocidad', sql.Int, velocidad);
    });
  } else {
    logger.debug({ telcod, incoming_set: set_value }, '[cache.dal] Using SP with set_value');
    // Si set_value viene con valor, usamos el SP normal
    await query(`
      EXEC dbo.sp_rcn_cont_cache_upsert
        @telcod=@p_telcod,
        @sescod=@p_sescod,
        @tracod=@p_tracod,
        @traraz=@p_traraz,
        @turno_cod=@p_turno_cod,
        @session_active=@p_session_active,
        @hil_act=@p_hil_act,
        @hil_turno=@p_hil_turno,
        @hil_start=@p_hil_start,
        @set_value=@p_set_value,
        @velocidad=@p_velocidad
    `, req => {
      req.input('p_telcod', sql.VarChar(10), telcod);
      req.input('p_sescod', sql.BigInt, sescod);
      req.input('p_tracod', sql.VarChar(15), tracod);
      req.input('p_traraz', sql.VarChar(120), traraz);
      req.input('p_turno_cod', sql.Char(1), turno_cod);
      req.input('p_session_active', sql.Bit, session_active ? 1 : 0);
      req.input('p_hil_act', sql.Int, hil_act);
      req.input('p_hil_turno', sql.Int, hil_turno);
      req.input('p_hil_start', sql.Int, finalHilStart);
      req.input('p_set_value', sql.Int, finalSetValue);
      req.input('p_velocidad', sql.Int, velocidad);
    });
  }

  // Leer directamente de la tabla en lugar de la vista para asegurar que set_value esté presente
  const rs = await query(`
    SELECT telcod, sescod, tracod, traraz, turno_cod, session_active,
           hil_act, hil_turno, hil_start, set_value, velocidad, updated_at
    FROM dbo.RCN_CONT_CACHE
    WHERE telcod = @telcod
  `, r => r.input('telcod', sql.VarChar(10), telcod));

  return rs.recordset[0] || null;
}

/** Vista completa para recuperación post-reinicio */
async function getRecovery() {
  const rs = await query(`
    SELECT *
    FROM dbo.VW_RCN_CONT_RECOVERY
    ORDER BY updated_at DESC
  `);
  return rs.recordset;
}

/** Obtener un telar específico desde la caché */
async function getByTelcod(telcod) {
  const rs = await query(`
    SELECT telcod, sescod, tracod, traraz, turno_cod, session_active,
           hil_act, hil_turno, hil_start, set_value, velocidad, updated_at
    FROM dbo.RCN_CONT_CACHE
    WHERE telcod = @telcod
  `, req => {
    req.input('telcod', sql.VarChar(10), telcod);
  });
  return rs.recordset[0] || null;
}

/** Actualización directa de set_value (bypass SP) */
async function updateSetValue(telcod, val) {
  await query(`
    UPDATE dbo.RCN_CONT_CACHE
    SET set_value = @val, updated_at = GETDATE()
    WHERE telcod = @telcod
  `, req => {
    req.input('telcod', sql.VarChar(10), telcod);
    req.input('val', sql.Int, val);
  });
  return { telcod, set_value: val };
}

module.exports = {
  upsert,
  getRecovery,
  getByTelcod,
  updateSetValue,
};

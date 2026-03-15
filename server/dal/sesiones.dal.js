'use strict';

const { sql, query, beginTransaction } = require('./db');

/**
 * Abre sesión (turno) para un trabajador.
 * Si ya tiene una sesión activa, la cierra automáticamente antes de abrir la nueva.
 * @returns fila creada
 */
async function abrir({ tracod, traraz = null, turno_cod, dev_uuid = null, ip_origen = null, user_agent = null, inicio = null }) {
  // Cierra cualquier sesión activa previa del mismo trabajador
  // CRITICAL: También limpiamos RCN_CONT_SESION_TELAR y RCN_CONT_CACHE
  // para evitar "sesiones fantasma" que bloquean la reasignación de telares.
  await query(`
    -- 1. Liberar telares asignados a sesiones activas del mismo trabajador
    UPDATE st
      SET st.activo = 0,
          st.asignado_hasta = SYSDATETIME()
    FROM dbo.RCN_CONT_SESION_TELAR st
    INNER JOIN dbo.RCN_CONT_SESION s ON st.sescod = s.sescod
    WHERE s.tracod = @tracod AND s.activo = 1 AND st.activo = 1;

    -- 2. Limpiar cache de esos telares (resetear session_active)
    UPDATE c
      SET c.session_active = 0,
          c.sescod = NULL,
          c.tracod = NULL,
          c.traraz = NULL,
          c.turno_cod = NULL,
          c.updated_at = SYSDATETIME()
    FROM dbo.RCN_CONT_CACHE c
    INNER JOIN dbo.RCN_CONT_SESION_TELAR st ON c.telcod = st.telcod
    INNER JOIN dbo.RCN_CONT_SESION s ON st.sescod = s.sescod
    WHERE s.tracod = @tracod AND s.activo = 1 AND c.session_active = 1;

    -- 3. Cerrar la sesión en sí
    UPDATE dbo.RCN_CONT_SESION
    SET fin = SYSDATETIME(),
        activo = 0,
        estado = 'F'
    WHERE tracod = @tracod AND activo = 1
  `, req => {
    req.input('tracod', sql.VarChar(15), tracod);
  });

  // Ahora abre la nueva sesión
  const now = inicio || new Date();
  const rs = await query(`
    INSERT INTO dbo.RCN_CONT_SESION (tracod, traraz, turno_cod, inicio, activo, estado, dev_uuid, ip_origen, user_agent)
    OUTPUT INSERTED.*
    VALUES (@tracod, @traraz, @turno_cod, @inicio, 1, 'A', @dev_uuid, @ip_origen, @user_agent)
  `, req => {
    req.input('tracod', sql.VarChar(15), tracod);
    req.input('traraz', sql.VarChar(120), traraz);
    req.input('turno_cod', sql.Char(1), turno_cod);
    req.input('inicio', sql.DateTime2, now);
    req.input('dev_uuid', sql.Char(36), dev_uuid);
    req.input('ip_origen', sql.VarChar(45), ip_origen);
    req.input('user_agent', sql.VarChar(200), user_agent);
  });
  return rs.recordset[0];
}

/** Cierra sesión (marca fin, activo=0, estado='F') */
async function cerrar({ sescod, fin = null }) {
  const now = fin || new Date();
  const rs = await query(`
    UPDATE dbo.RCN_CONT_SESION
      SET fin = @fin,
          activo = 0,
          estado = 'F'
    OUTPUT INSERTED.*
    WHERE sescod = @sescod
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('fin', sql.DateTime2, now);
  });
  return rs.recordset[0] || null;
}

/** Obtén una sesión por id */
async function getById(sescod) {
  const rs = await query(`
    SELECT *
    FROM dbo.RCN_CONT_SESION
    WHERE sescod = @sescod
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
  });
  return rs.recordset[0] || null;
}

/** Marca JTI activo (si luego manejas JWT por dispositivo) */
async function setActiveJti({ sescod, jti }) {
  const rs = await query(`
    UPDATE dbo.RCN_CONT_SESION SET active_jti = @jti
    OUTPUT INSERTED.*
    WHERE sescod = @sescod
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('jti', sql.VarChar(64), jti);
  });
  return rs.recordset[0] || null;
}

/** Obtén sesiones activas que superaron su tiempo límite (9h para turnos 1,2,3; 13h para 4,5) */
async function getExpiradas() {
  const rs = await query(`
    SELECT sescod, tracod, turno_cod, inicio
    FROM dbo.RCN_CONT_SESION
    WHERE activo = 1 
      AND (
        (turno_cod IN ('1', '2', '3') AND @Now >= DATEADD(hour, 9, inicio))
        OR
        (turno_cod IN ('4', '5') AND @Now >= DATEADD(hour, 13, inicio))
      )
  `, req => {
    req.input('Now', sql.DateTime2, new Date());
  });
  return rs.recordset || [];
}

module.exports = {
  abrir,
  cerrar,
  getById,
  setActiveJti,
  getExpiradas,
};

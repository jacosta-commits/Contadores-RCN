'use strict';

const { sql, query, beginTransaction } = require('./db');

/**
 * Abre sesión (turno) para un trabajador.
 * Si ya tiene una sesión activa, la cierra automáticamente antes de abrir la nueva.
 * @returns fila creada
 */
async function abrir({ tracod, traraz = null, turno_cod, dev_uuid = null, ip_origen = null, user_agent = null, inicio = null }) {
  // Cierra cualquier sesión activa previa del mismo trabajador
  await query(`
    UPDATE dbo.RCN_CONT_SESION
    SET fin = SYSDATETIME(),
        activo = 0,
        estado = 'F'
    WHERE tracod = @tracod AND activo = 1
  `, req => {
    req.input('tracod', sql.VarChar(15), tracod);
  });

  // Ahora abre la nueva sesión
  const rs = await query(`
    INSERT INTO dbo.RCN_CONT_SESION (tracod, traraz, turno_cod, inicio, activo, estado, dev_uuid, ip_origen, user_agent)
    OUTPUT INSERTED.*
    VALUES (@tracod, @traraz, @turno_cod, COALESCE(@inicio, SYSDATETIME()), 1, 'A', @dev_uuid, @ip_origen, @user_agent)
  `, req => {
    req.input('tracod', sql.VarChar(15), tracod);
    req.input('traraz', sql.VarChar(120), traraz);
    req.input('turno_cod', sql.Char(1), turno_cod);
    req.input('inicio', sql.DateTime2, inicio);
    req.input('dev_uuid', sql.Char(36), dev_uuid);
    req.input('ip_origen', sql.VarChar(45), ip_origen);
    req.input('user_agent', sql.VarChar(200), user_agent);
  });
  return rs.recordset[0];
}

/** Cierra sesión (marca fin, activo=0, estado='F') */
async function cerrar({ sescod, fin = null }) {
  const rs = await query(`
    UPDATE dbo.RCN_CONT_SESION
      SET fin = COALESCE(@fin, SYSDATETIME()),
          activo = 0,
          estado = 'F'
    OUTPUT INSERTED.*
    WHERE sescod = @sescod
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('fin', sql.DateTime2, fin);
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

module.exports = {
  abrir,
  cerrar,
  getById,
  setActiveJti,
};

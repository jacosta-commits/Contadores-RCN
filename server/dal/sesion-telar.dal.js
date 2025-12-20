'use strict';

const { sql, query } = require('./db');

/**
 * Asigna (upsert) un telar a la sesión.
 * - Usa UPDLOCK/HOLDLOCK para evitar duplicados concurrentes.
 * - Compatible con tablas con TRIGGERS (usa OUTPUT ... INTO @out).
 * Retorna la fila afectada.
 */
async function asignar({ sescod, telcod }) {
  const rs = await query(`
    SET NOCOUNT ON;

    DECLARE @out TABLE (
      sescod         BIGINT,
      telcod         VARCHAR(10),
      activo         BIT,
      asignado_desde DATETIME2 NULL,
      asignado_hasta DATETIME2 NULL
    );

    IF EXISTS (
      SELECT 1
      FROM dbo.RCN_CONT_SESION_TELAR WITH (UPDLOCK, HOLDLOCK)
      WHERE sescod = @sescod AND telcod = @telcod AND activo = 1
    )
    BEGIN
      -- No-op UPDATE para devolver la fila actual (dispara triggers de forma segura)
      UPDATE dbo.RCN_CONT_SESION_TELAR
        SET telcod = telcod
        OUTPUT inserted.sescod, inserted.telcod, inserted.activo,
               inserted.asignado_desde, inserted.asignado_hasta
        INTO @out
      WHERE sescod = @sescod AND telcod = @telcod AND activo = 1;
    END
    ELSE
    BEGIN
      INSERT dbo.RCN_CONT_SESION_TELAR (sescod, telcod, activo, asignado_desde)
        OUTPUT inserted.sescod, inserted.telcod, inserted.activo,
               inserted.asignado_desde, inserted.asignado_hasta
        INTO @out
      VALUES (@sescod, @telcod, 1, SYSDATETIME());
    END

    SELECT * FROM @out;
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), String(telcod));
  });

  return rs.recordset[0] || null;
}

/**
 * Quita (desactiva) un telar de la sesión.
 * Retorna la fila afectada (si existía activa).
 */
async function quitar({ sescod, telcod }) {
  const rs = await query(`
    SET NOCOUNT ON;

    DECLARE @out TABLE (
      sescod         BIGINT,
      telcod         VARCHAR(10),
      activo         BIT,
      asignado_desde DATETIME2 NULL,
      asignado_hasta DATETIME2 NULL
    );

    UPDATE dbo.RCN_CONT_SESION_TELAR
      SET activo = 0,
          asignado_hasta = SYSDATETIME()
      OUTPUT inserted.sescod, inserted.telcod, inserted.activo,
             inserted.asignado_desde, inserted.asignado_hasta
      INTO @out
    WHERE sescod = @sescod AND telcod = @telcod AND activo = 1;

    SELECT * FROM @out;
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), String(telcod));
  });

  return rs.recordset[0] || null;
}

/** Lista telares activos por sesión */
async function listActivos({ sescod }) {
  const rs = await query(`
    SET NOCOUNT ON;

    SELECT telcod, asignado_desde, asignado_hasta, activo
    FROM dbo.RCN_CONT_SESION_TELAR
    WHERE sescod = @sescod AND activo = 1
    ORDER BY asignado_desde DESC;
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
  });

  return rs.recordset;
}

/** ¿Quién tiene ocupado el telar (si lo está)? */
async function getOcupacionActual({ telcod }) {
  const rs = await query(`
    SELECT TOP (1) sescod, telcod, asignado_desde
    FROM dbo.RCN_CONT_SESION_TELAR
    WHERE telcod = @telcod AND activo = 1
    ORDER BY asignado_desde DESC;
  `, req => {
    req.input('telcod', sql.VarChar(10), String(telcod));
  });
  return rs.recordset[0] || null;
}

module.exports = {
  asignar,
  quitar,
  listActivos,
  getOcupacionActual,
};

'use strict';

const { sql, query } = require('./db');

/** Crea llamada/ticket */
async function crear({ sescod, telcod, categoria = null, mensaje = null }) {
  const rs = await query(`
    INSERT INTO dbo.RCN_CONT_LLAMADA (sescod, telcod, categoria, mensaje)
    OUTPUT INSERTED.*
    VALUES (@sescod, @telcod, @categoria, @mensaje)
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), telcod);
    req.input('categoria', sql.VarChar(30), categoria);
    req.input('mensaje', sql.VarChar(300), mensaje);
  });
  return rs.recordset[0];
}

/** Actualiza estado/atributos */
async function actualizar({ id, estado = null, supervisor = null, completada = null, ended_at = null }) {
  // Build dinámico de SET
  const sets = [];
  const bind = [];

  if (estado !== null) { sets.push('estado = @estado'); bind.push(['estado', sql.Char(1), estado]); }
  if (supervisor !== null) { sets.push('supervisor = @supervisor'); bind.push(['supervisor', sql.VarChar(60), supervisor]); }
  if (completada !== null) { sets.push('completada = @completada'); bind.push(['completada', sql.Bit, Number(completada)]); }
  if (ended_at !== null) { sets.push('ended_at = @ended_at'); bind.push(['ended_at', sql.DateTime2, ended_at]); }

  if (sets.length === 0) {
    // Nada que actualizar, devuelve estado actual
    const current = await query(`SELECT * FROM dbo.RCN_CONT_LLAMADA WHERE id=@id`, r => r.input('id', sql.BigInt, id));
    return current.recordset[0] || null;
  }

  const rs = await query(`
    UPDATE dbo.RCN_CONT_LLAMADA
      SET ${sets.join(', ')}
    OUTPUT INSERTED.*
    WHERE id = @id
  `, req => {
    req.input('id', sql.BigInt, id);
    bind.forEach(([n, t, v]) => req.input(n, t, v));
  });
  return rs.recordset[0] || null;
}

/** Listado con filtros opcionales */
async function listar({ estado = null, telcod = null, sescod = null, desde = null, hasta = null }) {
  let q = `
    SELECT id, sescod, telcod, categoria, mensaje, started_at, ended_at, estado, supervisor, completada
    FROM dbo.RCN_CONT_LLAMADA
    WHERE 1=1
  `;
  const params = [];
  if (estado) { q += ` AND estado=@estado`; params.push(['estado', sql.Char(1), estado]); }
  if (telcod) { q += ` AND telcod=@telcod`; params.push(['telcod', sql.VarChar(10), telcod]); }
  if (sescod) { q += ` AND sescod=@sescod`; params.push(['sescod', sql.BigInt, sescod]); }
  if (desde) { q += ` AND started_at>=@desde`; params.push(['desde', sql.DateTime2, desde]); }
  if (hasta) { q += ` AND started_at<@hasta`; params.push(['hasta', sql.DateTime2, hasta]); }
  q += ` ORDER BY started_at DESC`;

  const rs = await query(q, req => {
    params.forEach(([n, t, v]) => req.input(n, t, v));
  });
  return rs.recordset;
}

/** Cancela (Anula) todas las llamadas pendientes de una sesión */
async function cancelarPendientesPorSesion(sescod) {
  const rs = await query(`
    UPDATE dbo.RCN_CONT_LLAMADA
    SET estado = 'C', completada = 0, ended_at = SYSDATETIME()
    OUTPUT INSERTED.*
    WHERE sescod = @sescod AND estado = 'A'
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
  });
  return rs.recordset;
}

module.exports = {
  crear,
  actualizar,
  listar,
  cancelarPendientesPorSesion
};

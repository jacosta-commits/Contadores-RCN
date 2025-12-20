'use strict';

const { sql, query } = require('./db');

/**
 * Upsert checklist único por (sescod, telcod).
 * Campos soportados (ítems): rodillo_principal, sensores_urdimbre, hilos_fondo,
 * hilos_refuerzo, encarretadora, manchas_aceite
 */
async function upsert({ sescod, telcod, tracod = null, items = {} }) {
  const cols = {
    rodillo_principal: items.rodillo_principal ?? null,
    sensores_urdimbre: items.sensores_urdimbre ?? null,
    hilos_fondo: items.hilos_fondo ?? null,
    hilos_refuerzo: items.hilos_refuerzo ?? null,
    encarretadora: items.encarretadora ?? null,
    manchas_aceite: items.manchas_aceite ?? null,
  };

  const rs = await query(`
    MERGE dbo.RCN_CONT_CHK AS T
    USING (SELECT @sescod AS sescod, @telcod AS telcod) AS S
    ON (T.sescod = S.sescod AND T.telcod = S.telcod)
    WHEN MATCHED THEN
      UPDATE SET
        tracod = @tracod,
        rodillo_principal = @rodillo_principal,
        sensores_urdimbre = @sensores_urdimbre,
        hilos_fondo = @hilos_fondo,
        hilos_refuerzo = @hilos_refuerzo,
        encarretadora = @encarretadora,
        manchas_aceite = @manchas_aceite,
        realizado_at = SYSDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (sescod, telcod, tracod, rodillo_principal, sensores_urdimbre,
              hilos_fondo, hilos_refuerzo, encarretadora, manchas_aceite)
      VALUES (@sescod, @telcod, @tracod, @rodillo_principal, @sensores_urdimbre,
              @hilos_fondo, @hilos_refuerzo, @encarretadora, @manchas_aceite)
    OUTPUT inserted.*;
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), telcod);
    req.input('tracod', sql.VarChar(15), tracod);
    req.input('rodillo_principal', sql.VarChar(2), cols.rodillo_principal);
    req.input('sensores_urdimbre', sql.VarChar(2), cols.sensores_urdimbre);
    req.input('hilos_fondo', sql.VarChar(2), cols.hilos_fondo);
    req.input('hilos_refuerzo', sql.VarChar(2), cols.hilos_refuerzo);
    req.input('encarretadora', sql.VarChar(2), cols.encarretadora);
    req.input('manchas_aceite', sql.VarChar(2), cols.manchas_aceite);
  });

  return rs.recordset[0];
}

/** Obtén checklist por (sescod, telcod) */
async function get({ sescod, telcod }) {
  const rs = await query(`
    SELECT *
    FROM dbo.RCN_CONT_CHK
    WHERE sescod = @sescod AND telcod = @telcod
  `, req => {
    req.input('sescod', sql.BigInt, sescod);
    req.input('telcod', sql.VarChar(10), telcod);
  });
  return rs.recordset[0] || null;
}

module.exports = {
  upsert,
  get,
};

'use strict';

const env = require('../lib/env');
const logger = require('../lib/logger');
const dhr = require('./db.hr');             // << usa el pool de RR.HH.
const sql = dhr.sql;

const HR_DB     = env.HR_DB     || 'APPSHEET001';
const HR_SCHEMA = env.HR_SCHEMA || 'dbo';
const HR_VIEW   = env.HR_VIEW   || 'VIEW_FISA_RRHH_TRABAJADOR';
const OBJ = `[${HR_DB}].[${HR_SCHEMA}].[${HR_VIEW}]`;

// Normaliza a 5 dígitos (00001, 00787, etc.)
function normalizeTracod(v) {
  return String(v || '').replace(/\D/g, '').padStart(5, '0');
}

module.exports.getTrabajadorByTracod = async (tracod) => {
  const code = normalizeTracod(tracod);

  try {
    const pool = await dhr.getPool();
    const req = pool.request();
    req.input('tracod', sql.VarChar(10), code);

    const { recordset } = await req.query(`
      SELECT TOP 1
        LTRIM(RTRIM(tracod)) AS tracod,
        LTRIM(RTRIM(traraz)) AS traraz
      FROM ${OBJ}
      WHERE LTRIM(RTRIM(tracod)) = @tracod
    `);

    return recordset?.[0] || null;
  } catch (e) {
    // mensaje claro si la vista no existe o la conexión falla
    if (/Invalid object name/i.test(e.message)) {
      throw new Error(`No se encuentra ${OBJ} en el servidor RR.HH. Verifica HR_SERVER/HR_DB o el nombre de la vista.`);
    }
    throw e;
  }
};

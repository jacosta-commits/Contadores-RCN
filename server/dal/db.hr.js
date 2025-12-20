'use strict';

const sql = require('mssql');
const env = require('../lib/env');
const logger = require('../lib/logger');

let poolPromise;

function cfg() {
  return {
    user: env.HR_USER,
    password: env.HR_PASS,
    server: env.HR_SERVER,
    database: env.HR_DB || 'APPSHEET001',
    port: env.HR_PORT ? Number(env.HR_PORT) : 1433,
    options: {
      encrypt: String(env.HR_ENCRYPT).toLowerCase() === 'true',
      trustServerCertificate: String(env.HR_TRUST_SERVER_CERT).toLowerCase() === 'true',
      instanceName: env.HR_INSTANCE || undefined,
      enableArithAbort: true,
    },
    pool: {
      max: env.HR_POOL_MAX ? Number(env.HR_POOL_MAX) : 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: env.HR_REQ_TIMEOUT_MS ? Number(env.HR_REQ_TIMEOUT_MS) : 30000,
  };
}

async function getPool() {
  if (!poolPromise) {
    const c = cfg();
    logger.info(`[db.hr] connecting to MSSQL ${c.server}/${c.database}`);
    poolPromise = new sql.ConnectionPool(c)
      .connect()
      .then(p => { logger.info('[db.hr] MSSQL connected (RRHH)'); return p; })
      .catch(err => { logger.error('[db.hr] MSSQL connection error (RRHH):', err); poolPromise = null; throw err; });
  }
  return poolPromise;
}

async function query(q, binder) {
  const pool = await getPool();
  const req = pool.request();
  if (binder) binder(req);
  return req.query(q);
}

module.exports = { sql, getPool, query };

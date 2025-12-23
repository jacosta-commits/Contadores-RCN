'use strict';

/**
 * db.js — Pool MSSQL + utilidades
 * - Usa mssql con pool compartido
 * - Expone helpers para queries y transacciones
 */
const sql = require('mssql');
const env = require('../lib/env');
const logger = require('../lib/logger');

let poolPromise;

/** Construye la config MSSQL desde env.js */
function buildConfig() {
  return {
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    server: env.DB_SERVER,
    database: env.DB_NAME || 'ZENTRIK',
    port: env.DB_PORT ? Number(env.DB_PORT) : 1433,
    options: {
      trustServerCertificate: env.DB_TRUST_CERT === 'true',
      encrypt: env.DB_ENCRYPT === 'true',
      enableArithAbort: true,
      // 👇 Importante: evitar desfase -5h en DATETIME/DATETIME2
      useUTC: false,
    },
    pool: {
      max: env.DB_POOL_MAX ? Number(env.DB_POOL_MAX) : 100, // Aumentado para soportar ~70 usuarios concurrentes
      min: 0,
      idleTimeoutMillis: 30000,
    },
    // timeouts (si no existen en env, usan defaults razonables)
    requestTimeout: env.DB_TIMEOUT ? Number(env.DB_TIMEOUT) : 30000,
    connectionTimeout: env.DB_CONN_TIMEOUT_MS
      ? Number(env.DB_CONN_TIMEOUT_MS)
      : 15000,
  };
}

/** Retorna (y crea si falta) el pool compartido */
async function getPool() {
  if (!poolPromise) {
    const cfg = buildConfig();
    logger.info(`[db] connecting to MSSQL ${cfg.server}/${cfg.database}`);
    poolPromise = new sql.ConnectionPool(cfg)
      .connect()
      .then(pool => {
        logger.info('[db] MSSQL connected');
        return pool;
      })
      .catch(err => {
        logger.error('[db] MSSQL connection error:', err);
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Ejecuta un query simple con parámetros opcionales.
 * @param {string} q - SQL text
 * @param {(req: sql.Request)=>void} binder - función que hace req.input(...)
 * @returns {Promise<sql.IResult<any>>}
 */
async function query(q, binder) {
  const pool = await getPool();
  const req = pool.request();
  if (typeof binder === 'function') binder(req);
  return req.query(q);
}

/**
 * Inicia transacción y expone helpers.
 */
async function beginTransaction() {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const request = new sql.Request(tx);

  return {
    tx,
    request,
    /** Ejecuta un query dentro de la transacción */
    query: (q, binder) => {
      if (binder) binder(request);
      return request.query(q);
    },
    /** Confirma la transacción */
    commit: () => tx.commit(),
    /** Revierte la transacción */
    rollback: () => tx.rollback(),
  };
}

module.exports = {
  sql,
  getPool,
  query,
  beginTransaction,
};

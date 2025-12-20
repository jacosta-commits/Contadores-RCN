'use strict';

/**
 * Carga y normaliza variables de entorno para toda la app.
 * Compatible con tu .env (DB_PASS) y con la DAL (usa DB_PASSWORD).
 */
require('dotenv').config();

function get(name, def) {
  const v = process.env[name];
  return (v === undefined || v === '') ? def : v;
}
function bool(name, def = false) {
  const v = get(name);
  if (v === undefined) return def;
  return ['1','true','yes','y','on'].includes(String(v).toLowerCase());
}
function int(name, def) {
  const v = get(name);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function csv(name, def = []) {
  const v = get(name);
  if (!v) return def;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

const NODE_ENV = get('NODE_ENV', 'development');

const env = {
  // ========= Servidor HTTP =========
  NODE_ENV,
  HOST: get('HOST', '0.0.0.0'),
  PORT: int('PORT', 3020),
  PUBLIC_ORIGIN: get('PUBLIC_ORIGIN', null),

  // CORS
  CORS_ORIGINS: csv('CORS_ORIGINS', ['*']),
  CORS_CREDENTIALS: bool('CORS_CREDENTIALS', false),

  // Socket.IO
  SOCKET_PATH: get('SOCKET_PATH', '/socket.io'),

  // Logging
  LOG_LEVEL: get('LOG_LEVEL', 'info'),

  // ========= BD ZENTRIK =========
  DB_SERVER: get('DB_SERVER', undefined),
  DB_NAME: get('DB_NAME', 'ZENTRIK'),
  DB_USER: get('DB_USER', 'sa'),
  // Alias para la DAL: expone DB_PASSWORD a partir de DB_PASS (o DB_PASSWORD si existiera)
  DB_PASSWORD: get('DB_PASS', get('DB_PASSWORD', undefined)),
  DB_PORT: int('DB_PORT', 1433),
  DB_ENCRYPT: bool('DB_ENCRYPT', false),
  DB_TRUST_SERVER_CERT: bool('DB_TRUST_SERVER_CERT', true),
  DB_POOL_MIN: int('DB_POOL_MIN', 0),
  DB_POOL_MAX: int('DB_POOL_MAX', 10),
  // Tiempos (la DAL usa DB_TIMEOUT para requestTimeout)
  DB_CONN_TIMEOUT_MS: int('DB_CONN_TIMEOUT_MS', 15000),
  DB_TIMEOUT: int('DB_REQ_TIMEOUT_MS', 30000),

  // ========= BD RR.HH. (opcional) =========
  HR_SERVER: get('HR_SERVER', undefined),
  HR_DB: get('HR_DB', 'APPSHEET001'),
  HR_USER: get('HR_USER', 'sa'),
  HR_PASS: get('HR_PASS', undefined),
  HR_ENCRYPT: bool('HR_ENCRYPT', false),
  HR_TRUST_SERVER_CERT: bool('HR_TRUST_SERVER_CERT', true),

  // ========= Telegram =========
  TG_BOT_TOKEN: get('TG_BOT_TOKEN', null),
  CHAT_ALLOW: csv('CHAT_ALLOW', []).map(v => {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }),

  // Helpers
  isProd: NODE_ENV === 'production',
  isDev: NODE_ENV !== 'production',
};

module.exports = env;

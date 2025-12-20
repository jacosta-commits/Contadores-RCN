'use strict';

/**
 * Logger minimalista con niveles y timestamp ISO.
 * Respeta LOG_LEVEL de env (debug < info < warn < error).
 */
const env = require('./env');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESH = LEVELS[(env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function ts() { return new Date().toISOString(); }

function fmt(meta, args) {
  if (!meta) return args;
  return [meta, ...args];
}

function log(level, meta, ...args) {
  const lv = LEVELS[level] ?? LEVELS.info;
  if (lv < THRESH) return;

  const line = `[${ts()}] ${level.toUpperCase()}`;
  const payload = fmt(meta, args);

  // Evitar reventar por objetos cíclicos
  const safe = payload.map((x) => {
    if (x instanceof Error) {
      return {
        name: x.name,
        message: x.message,
        stack: env.isDev ? x.stack : undefined,
      };
    }
    return x;
  });

  // Enviar a consola por nivel
  /* eslint-disable no-console */
  if (level === 'error') console.error(line, ...safe);
  else if (level === 'warn') console.warn(line, ...safe);
  else console.log(line, ...safe);
  /* eslint-enable no-console */
}

module.exports = {
  debug: (...a) => log('debug', null, ...a),
  info: (...a) => log('info', null, ...a),
  warn: (...a) => log('warn', null, ...a),
  error: (...a) => log('error', null, ...a),

  /** Con meta fijo para este logger hijo (ej: {mod:'app'}) */
  child(meta = {}) {
    return {
      debug: (...a) => log('debug', meta, ...a),
      info: (...a) => log('info', meta, ...a),
      warn: (...a) => log('warn', meta, ...a),
      error: (...a) => log('error', meta, ...a),
    };
  },
};

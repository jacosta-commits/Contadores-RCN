'use strict';

/**
 * HttpError + middlewares centralizados para Express
 * - Usa err.status (o 500)
 * - En producción oculta stack; en dev la incluye.
 */
const env = require('./env');
const logger = require('./logger');

class HttpError extends Error {
  /**
   * @param {number} status Código HTTP
   * @param {string} message Mensaje
   * @param {object} [details] Datos adicionales seguros de exponer
   */
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = Number(status) || 500;
    this.details = details;
    // Señal para exponer mensaje al cliente si < 500
    this.expose = this.status < 500;
  }
}

/** 404 para rutas no encontradas */
function notFound(_req, _res, next) {
  next(new HttpError(404, 'Recurso no encontrado'));
}

/** Heurística para mapear ciertos errores de SQL a códigos semánticos */
function mapSqlToHttp(err) {
  const msg = String(err.message || '').toLowerCase();

  // Trigger de límite 2 telares
  if (msg.includes('no se permiten más de 2 telares activos por sesión')) {
    return 409;
  }
  // Unicidad / duplicados
  if (msg.includes('unique') || msg.includes('duplicat') || msg.includes('ya existe')) {
    return 409;
  }
  // Violación de CHECK / datos inválidos
  if (msg.includes('check constraint') || msg.includes('ck_rcn')) {
    return 400;
  }
  return null;
}

/** Manejador central de errores Express */
function errorHandler(err, req, res, _next) {
  // Normaliza status
  let status = Number(err.status || err.statusCode) || 500;
  if (status === 500) {
    const maybe = mapSqlToHttp(err);
    if (maybe) status = maybe;
  }

  const expose = (err.expose === true) || status < 500;

  // Log enriquecido (no exponer stack en prod)
  logger.error({
    path: req.originalUrl,
    method: req.method,
    status,
  }, err);

  const payload = {
    ok: false,
    error: {
      status,
      message: expose ? (err.message || 'Error') : 'Internal Server Error',
      code: err.code || undefined,
      details: expose ? err.details : undefined,
    },
  };

  if (env.isDev && err.stack) {
    payload.error.stack = err.stack.split('\n').map(s => s.trim());
  }

  res.status(status).json(payload);
}

module.exports = {
  HttpError,
  notFound,
  errorHandler,
};

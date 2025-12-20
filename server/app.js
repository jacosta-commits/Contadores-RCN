'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const env = require('./lib/env');
const logger = require('./lib/logger');
const { notFound, errorHandler } = require('./lib/errors');

// Rutas v1 (HTTP → services)
const v1 = require('./routes/v1');

const app = express();

/* ========== Config base ========== */
app.disable('x-powered-by');
// Confiamos en proxy (PM2/Nginx) para IP real, útil para logs/ratelimits si luego agregas
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

/* ========== Seguridad + CORS ========== */
const allowOrigins = Array.isArray(env.CORS_ORIGINS) ? env.CORS_ORIGINS : ['*'];
const originOption = (allowOrigins.length === 1 && allowOrigins[0] === '*') ? true : allowOrigins;

app.use(cors({
  origin: originOption,                    // true = reflejar cualquier Origin (equivale a '*')
  credentials: !!env.CORS_CREDENTIALS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Helmet relajado para permitir Ws + módulos
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // si luego quieres CSP, añádela con ws: y self
  crossOriginOpenerPolicy: false,
  originAgentCluster: false
}));

/* ========== Compresión + parsers ========== */
app.use(compression());
app.use(express.json({ limit: env.BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT || '1mb' }));
app.use(cookieParser());

/* ========== Logger de peticiones minimal ========== */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    // Suprimir logs de cache para reducir ruido
    if (req.originalUrl.includes('/api/v1/cache')) return;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${ms}ms`);
  });
  next();
});

/* ========== Static web: operator/supervisor ========== */
const webRoot = path.join(__dirname, '..', 'web');

// Archivos estáticos compartidos (css/js/assets)
app.use('/', express.static(webRoot, {
  index: false,
  redirect: false,            // ⬅️ evita redirect /operator → /operator/
  maxAge: env.STATIC_MAXAGE || '1h',
  etag: true,
}));

// Entradas limpias para las dos vistas
app.get(['/operator', '/operator/'], (_req, res) => {
  res.sendFile(path.join(webRoot, 'operator', 'index.html'));
});

app.get(['/supervisor', '/supervisor/'], (_req, res) => {
  res.sendFile(path.join(webRoot, 'supervisor', 'index.html'));
});

// Raíz simple (opcional)
app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    name: 'RCN Contadores',
    env: env.NODE_ENV || 'development',
    version: env.APP_VERSION || '1.0.0',
    api: '/api/v1',
    web: ['/operator', '/supervisor'],
  });
});

/* ========== API v1 ========== */
app.use('/api/v1', v1);

/* ========== 404 y manejador central de errores ========== */
app.use(notFound);
app.use(errorHandler);

module.exports = app;

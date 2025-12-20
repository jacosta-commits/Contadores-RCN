'use strict';

const http = require('http');
const path = require('path');
const app = require('./app');

const env = require('./lib/env');
const logger = require('./lib/logger');
const { createSocketServer, getIO } = require('./sockets');

const db = require('./dal/db'); // pool MSSQL (init/close según tu implementación)

const PORT = Number(env.PORT || 8080);
const HOST = env.HOST || '0.0.0.0';

let httpServer = null;

/**
 * Inicializa DB (si tu dal/db expone init/connect)
 */
async function initDatabase() {
  try {
    if (db && typeof db.init === 'function') {
      await db.init();
      logger.info('[db] pool inicializado (init)');
    } else if (db && typeof db.connect === 'function') {
      await db.connect();
      logger.info('[db] pool inicializado (connect)');
    } else if (db && typeof db.getPool === 'function') {
      // fuerza creación perezosa del pool
      await db.getPool();
      logger.info('[db] pool inicializado (getPool)');
    } else if (db && db.poolPromise) {
      await db.poolPromise;
      logger.info('[db] pool inicializado (poolPromise)');
    } else {
      logger.warn('[db] no hay init/connect/getPool definidos; se asumirá lazy connect');
    }
  } catch (err) {
    logger.error('[db] error al inicializar pool:', err);
    throw err;
  }
}

/**
 * Cierra DB (si tu dal/db expone close/end)
 */
async function closeDatabase() {
  try {
    if (db && typeof db.close === 'function') {
      await db.close();
      logger.info('[db] pool cerrado (close)');
    } else if (db && typeof db.end === 'function') {
      await db.end();
      logger.info('[db] pool cerrado (end)');
    } else if (db && db.sql && typeof db.sql.close === 'function') {
      await db.sql.close();
      logger.info('[db] pool cerrado (mssql.close)');
    }
  } catch (err) {
    logger.error('[db] error al cerrar pool:', err);
  }
}

/**
 * Arranque principal
 */
async function start() {
  await initDatabase();

  httpServer = http.createServer(app);

  // Monta Socket.IO sobre el HTTP server
  createSocketServer(httpServer);

  httpServer.listen(PORT, HOST, () => {
    logger.info(`[http] escuchando en http://${HOST}:${PORT}  (env=${env.NODE_ENV || 'dev'})`);
  });

  // Inicia el poller worker automáticamente
  try {
    const pollerPath = path.join(__dirname, '..', 'workers', 'poller', 'index.js');
    const { main: pollerMain } = require(pollerPath);
    // Ejecuta el poller en background (no bloqueante)
    pollerMain().catch((e) => {
      logger.error('[poller] error en worker:', e);
    });
    logger.info('[poller] worker iniciado automáticamente');
  } catch (err) {
    logger.warn('[poller] no se pudo iniciar worker automáticamente:', err.message);
  }

  // Eventos de servidor
  httpServer.on('error', (err) => {
    logger.error('[http] error:', err);
    process.exitCode = 1;
  });

  httpServer.on('close', () => {
    logger.info('[http] server cerrado');
  });

  // Señales para apagado ordenado
  const shutdown = async (signal) => {
    try {
      logger.info(`[sys] signal ${signal} recibida — apagando...`);

      // Detén nuevas conexiones
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
      }

      // Cierra Socket.IO
      try {
        const io = getIO();
        await new Promise((resolve) => io.close(resolve));
        logger.info('[socket] Socket.IO cerrado');
      } catch (_) {
        /* noop: si no estaba creado o ya se cerró */
      }

      // DB
      await closeDatabase();

      logger.info('[sys] apagado completo. Bye.');
      process.exit(0);
    } catch (err) {
      logger.error('[sys] error al apagar:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Errores no controlados
  process.on('unhandledRejection', (reason) => {
    logger.error('[sys] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('[sys] uncaughtException:', err);
    // Opcional: intenta apagado ordenado
    setTimeout(() => process.exit(1), 250);
  });
}

// Ejecuta
start().catch((err) => {
  logger.error('[boot] fallo al iniciar:', err);
  process.exit(1);
});

// Export para pruebas si lo necesitas
module.exports = { app };

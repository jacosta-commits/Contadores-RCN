const db = require('./dal/db');
const logger = require('./lib/logger');

async function cleanup() {
    try {
        const pool = await db.getPool();

        logger.info('Starting full DB cleanup for session sync issues...');

        // 1. Desasignar TODO de sesion-telar
        const p1 = await pool.request().query(`
      UPDATE dbo.RCN_CONT_SESION_TELAR
      SET activo = 0,
          asignado_hasta = ISNULL(asignado_hasta, SYSDATETIME())
      WHERE activo = 1;
    `);
        logger.info(`Unassigned ${p1.rowsAffected[0]} looms.`);

        // 2. Limpiar cache (liberar la memoria de Node)
        const p2 = await pool.request().query(`
      UPDATE dbo.RCN_CONT_CACHE
      SET session_active = 0,
          sescod = NULL,
          tracod = NULL,
          traraz = NULL,
          turno_cod = NULL,
          updated_at = SYSDATETIME();
    `);
        logger.info(`Reset ${p2.rowsAffected[0]} caches.`);

        // 3. Cerrar todas las sesiones
        const p3 = await pool.request().query(`
      UPDATE dbo.RCN_CONT_SESION
      SET activo = 0, 
          estado = 'F', 
          fin = ISNULL(fin, SYSDATETIME())
      WHERE activo = 1;
    `);
        logger.info(`Closed ${p3.rowsAffected[0]} sessions.`);

        // 4. Cerrar llamadas
        const p4 = await pool.request().query(`
      UPDATE dbo.RCN_CONT_LLAMADA
      SET estado = 'C',
          completada = 1,
          ended_at = ISNULL(ended_at, SYSDATETIME())
      WHERE estado IN ('P', 'A'); 
    `);
        logger.info(`Closed ${p4.rowsAffected[0]} tickets.`);

        logger.info('Cleanup complete.');
    } catch (err) {
        logger.error('DB Cleanup failed:', err);
    } finally {
        process.exit(0);
    }
}

cleanup();

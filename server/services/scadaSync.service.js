'use strict';

const logger = require('../lib/logger');
const { getPool, sql } = require('../dal/db');
const MAIN_DB = process.env.DB_NAME || 'ZENTRIK';

class ScadaSyncService {
    constructor() {
        this.timer = null;
        this.isRunning = false;
        this.intervalMs = 60 * 1000; // 1 minuto por defecto
    }

    start() {
        if (this.timer) return;
        logger.info('[scada-sync] Iniciando servicio de sincronización SCADA...');

        // Ejecutar inmediatamente la primera vez
        this.syncAllTeares().catch(err => logger.error('[scada-sync] Error inicial:', err));

        // Configurar el ciclo de polling
        this.timer = setInterval(async () => {
            if (this.isRunning) {
                logger.warn('[scada-sync] El ciclo anterior aún está corriendo, saltando este turno.');
                return;
            }

            this.isRunning = true;
            try {
                await this.syncAllTeares();
            } catch (err) {
                logger.error('[scada-sync] Error en el ciclo de sincronización:', err);
            } finally {
                this.isRunning = false;
            }
        }, this.intervalMs);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('[scada-sync] Servicio detenido.');
        }
    }

    /**
     * Obtiene la lista de telares activos y llama al SP de sincronización para cada uno.
     */
    async syncAllTeares() {
        const pool = await getPool();

        // 1. Obtener todos los telares de la planta (RCN_MAESTRO_TELAR)
        // Asumimos que la tabla de telares se llama dbo.RCN_MAESTRO_TELAR o similar
        // Si necesitas sincronizar solo los que interesan, se puede ajustar el WHERE
        const result = await pool.request().query(`
      SELECT telcod 
      FROM [${MAIN_DB}].dbo.RCN_CONT_TELAR 
      WHERE activo = 1
    `);

        const telares = result.recordset;
        if (!telares || telares.length === 0) {
            logger.warn('[scada-sync] No se encontraron telares activos para sincronizar.');
            return;
        }

        // 2. Ejecutar el SP por cada telar
        for (const row of telares) {
            const telcod = row.telcod;
            try {
                logger.info(`[scada-sync] Consultando SCADA para telar: ${telcod}`);

                // A) Leer datos del SCADA directamente desde Node.js
                // Usamos '01' como primer parámetro fijo según el SP
                const scadaReq = pool.request();
                scadaReq.input('empcod', sql.VarChar(10), '01');
                scadaReq.input('ctcod', sql.VarChar(10), telcod);
                scadaReq.timeout = 30000;

                const scadaResult = await scadaReq.execute(`[Medidores_2023].dbo.PA_PRD_SCADA001`);

                const scadaData = scadaResult.recordset;

                // Normalizar claves a minúsculas y formatear fechas
                const normalizedData = (scadaData || []).map(row => {
                    const newRow = {};
                    for (const key in row) {
                        const val = row[key];
                        // Convertir a minúscula el nombre de columna
                        const lowerKey = key.toLowerCase();
                        if (val instanceof Date) {
                            // SQL Server espera formato YYYY-MM-DDTHH:mm:ss.sssZ para JSON
                            newRow[lowerKey] = val.toISOString();
                        } else if (typeof val === 'string') {
                            newRow[lowerKey] = val.trim();
                        } else if (typeof val === 'boolean') {
                            newRow[lowerKey] = val ? 1 : 0;
                        } else {
                            newRow[lowerKey] = val;
                        }
                    }
                    return newRow;
                });

                const jsonData = JSON.stringify(normalizedData);


                // B) Pasar el JSON al SP de ZENTRIK
                const syncReq = pool.request();
                syncReq.input('telcod', sql.VarChar(20), telcod);
                syncReq.input('jsonData', sql.NVarChar(sql.MAX), jsonData);
                syncReq.timeout = 30000;

                await syncReq.execute(`[${MAIN_DB}].dbo.sp_rcn_cont_sync_operacion_scada`);

                if (normalizedData.length > 0) {
                    logger.info(`[scada-sync] Telar ${telcod} sincronizado OK (${normalizedData.length} filas).`);
                }
            } catch (err) {
                logger.error(`[scada-sync] Fallo al sincronizar el telar ${telcod}:`, err.message);
            }
        }

        logger.info(`[scada-sync] Finalizó la sincronización de ${telares.length} telares.`);
    }
}

module.exports = new ScadaSyncService();

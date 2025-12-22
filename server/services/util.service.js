'use strict';

const logger = require('../lib/logger').child({ mod: 'util.service' });
const cacheDAL = require('../dal/cache.dal');

/**
 * Resetea el contador acumulado (hil_act) de un telar.
 * Esto es útil para reiniciar el conteo de un lote o turno manualmente.
 */
async function resetCounter(telcod) {
    // Obtener estado actual de CACHE para saber el valor visual
    const currentCache = await cacheDAL.getByTelcod(telcod);
    if (!currentCache) {
        throw new Error(`Telar ${telcod} no encontrado en caché`);
    }

    // Obtener configuración actual de TELAR para saber el offset anterior
    const telaresDAL = require('../dal/telares.dal');
    const currentTelar = await telaresDAL.getByTelcod(telcod);
    const oldOffset = currentTelar?.hil_acum_offset || 0;

    // Calcular nuevo offset:
    // Raw = Visual + OldOffset
    // Queremos que Visual sea 0, así que NewOffset = Raw
    const raw = (currentCache.hil_act || 0) + oldOffset;
    const newOffset = raw;

    // 1. Emitir cambio por WS INMEDIATAMENTE (Optimistic UI)
    try {
        const { bus } = require('../sockets');
        bus.telar.state(telcod, { telcod, hil_act: 0 });
    } catch (e) {
        logger.warn({ err: e.message }, 'Error emitiendo WS en resetCounter');
    }

    // 2. Actualizar offset persistente en TELAR
    await telaresDAL.updateAcumOffset(telcod, newOffset);

    // 3. Actualizar visual en CACHE (opcional, el poller lo corregirá, pero para feedback inmediato)
    // No pasamos ...currentCache ni set_value para forzar el uso del UPDATE directo en cache.dal.js
    // y así poder actualizar hil_acum_offset (que el SP no soporta aún).
    await cacheDAL.upsert({
        telcod,
        hil_act: 0,
        hil_acum_offset: newOffset
    });

    logger.info({ telcod, newOffset }, 'Contador HIL. ACUM reseteado (nuevo offset)');

    return { telcod, hil_act: 0, hil_acum_offset: newOffset };
}

module.exports = { resetCounter };

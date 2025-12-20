'use strict';

const logger = require('../lib/logger').child({ mod: 'set.service' });
const cacheDAL = require('../dal/cache.dal');

/**
 * Actualiza el set_value (meta de lote) para un telar.
 * Permite que el operario defina una meta editable.
 */
async function updateSet({ telcod, set_value }) {
    // Obtener estado actual del telar
    const current = await cacheDAL.getByTelcod(telcod);
    if (!current) {
        throw new Error(`Telar ${telcod} no encontrado en caché`);
    }

    // Actualizar solo set_value usando UPDATE directo para garantizar persistencia
    await cacheDAL.updateSetValue(current.telcod, Number(set_value) || 0);

    logger.info({ telcod, set_value }, 'SET actualizado');

    // Emitir cambio por WS
    try {
        const { bus } = require('../sockets');
        bus.telar.state(telcod, { telcod, set_value: Number(set_value) || 0 });
    } catch (e) {
        logger.warn({ err: e.message }, 'Error emitiendo WS en updateSet');
    }

    return { telcod, set_value: Number(set_value) || 0 };
}

module.exports = { updateSet };

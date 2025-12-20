'use strict';

const logger = require('../lib/logger').child({ mod: 'util.service' });
const cacheDAL = require('../dal/cache.dal');

/**
 * Resetea el contador acumulado (hil_act) de un telar.
 * Esto es útil para reiniciar el conteo de un lote o turno manualmente.
 */
async function resetCounter(telcod) {
    // Obtener estado actual
    const current = await cacheDAL.getByTelcod(telcod);
    if (!current) {
        throw new Error(`Telar ${telcod} no encontrado en caché`);
    }

    // Para resetear correctamente:
    // - CALC: hil_start debe ajustarse al "pulse offset" actual para que el siguiente delta sea 0
    // - PLC: hil_start debe ajustarse al valor crudo del PLC actual
    // En ambos casos, la solución es: hil_start = current.hil_act + current.hil_start
    // (Valor Visual + Offset Anterior = Valor Crudo Actual)

    const newHilStart = (current.hil_act || 0) + (current.hil_start || 0);

    await cacheDAL.upsert({
        ...current,
        hil_start: newHilStart,  // Nuevo offset
        hil_act: 0                // Contador visual a 0
    });

    logger.info({ telcod, newHilStart }, 'Contador reseteado a 0 con nuevo hil_start');

    // Emitir cambio por WS
    try {
        const { bus } = require('../sockets');
        bus.telar.state(telcod, { telcod, hil_act: 0, hil_start: newHilStart });
    } catch (e) {
        logger.warn({ err: e.message }, 'Error emitiendo WS en resetCounter');
    }

    return { telcod, hil_act: 0, hil_start: newHilStart };
}

module.exports = { resetCounter };

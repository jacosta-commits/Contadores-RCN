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
    const val = Number(set_value) || 0;
    await cacheDAL.updateSetValue(current.telcod, val);

    logger.info({ telcod, set_value: val }, 'SET actualizado en DB');

    // Intentar escribir en PLC si corresponde
    try {
        const telaresDAL = require('../dal/telares.dal');
        const modbusReader = require('../../workers/poller/modbus.reader');

        // Necesitamos la config completa (IP, offsets) que no está en cacheDAL
        const config = await telaresDAL.getByTelcod(telcod);

        if (config && config.modo === 'PLC' && config.plc_base_offset != null && config.plc_set_rel != null) {
            const addr = config.plc_base_offset + config.plc_set_rel;
            // Adaptar objeto para getClient (espera modbusIP, etc.)
            const telarObj = {
                modbusIP: config.modbus_ip,
                modbusPort: config.modbus_port,
                modbusID: config.modbus_unit_id,
                telarKey: telcod
            };

            logger.info({ telcod, addr, val }, '[set.service] Escribiendo SET en PLC...');
            await modbusReader.writeRegister(telarObj, addr, val);
        }
    } catch (e) {
        logger.error({ err: e.message, telcod }, '[set.service] Error escribiendo en PLC (se ignoró, solo DB actualizada)');
        // No lanzamos error para no romper la UX, pero logueamos fuerte
    }

    // Emitir cambio por WS
    try {
        const { bus } = require('../sockets');
        bus.telar.state(telcod, { telcod, set_value: val });
    } catch (e) {
        logger.warn({ err: e.message }, 'Error emitiendo WS en updateSet');
    }

    return { telcod, set_value: val };
}

module.exports = { updateSet };

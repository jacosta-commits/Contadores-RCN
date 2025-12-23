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

    // LÓGICA DIFERENCIADA: PLC vs CALC
    if (currentTelar.modo === 'PLC') {
        // PLC: Mandar pulso al coil de reset
        const modbusReader = require('../../workers/poller/modbus.reader');
        // Necesitamos construir un objeto "telar" mínimo para el cliente Modbus
        // Usamos los datos de currentTelar (que viene de la DB)
        const telarObj = {
            modbusIP: currentTelar.modbus_ip,
            modbusPort: currentTelar.modbus_port,
            modbusID: currentTelar.modbus_unit_id,
            telarKey: telcod
        };

        if (currentTelar.plc_coil_reset !== null) {
            logger.info({ telcod, coil: currentTelar.plc_coil_reset }, 'Enviando pulso RESET a PLC');
            // Ejecutar en background para no bloquear respuesta HTTP si tarda
            modbusReader.pulseCoil(telarObj, currentTelar.plc_coil_reset)
                .catch(e => logger.error({ err: e.message, telcod }, 'Error enviando pulso RESET a PLC'));
        } else {
            logger.warn({ telcod }, 'Intento de reset PLC sin plc_coil_reset configurado');
        }

        // No actualizamos offset en DB para PLC.
        // Pero sí actualizamos caché visual a 0 para consistencia inmediata
        await cacheDAL.upsert({
            telcod,
            hil_act: 0
            // No tocamos hil_acum_offset
        });

        return { telcod, hil_act: 0, mode: 'PLC' };

    } else {
        // CALC: Lógica de offset (existente)

        // Calcular nuevo offset:
        // Raw = Visual + OldOffset
        // Queremos que Visual sea 0, así que NewOffset = Raw
        const raw = (currentCache.hil_act || 0) + oldOffset;
        const newOffset = raw;

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
        return { telcod, hil_act: 0, hil_acum_offset: newOffset, mode: 'CALC' };
    }

    return { telcod, hil_act: 0, hil_acum_offset: newOffset };
}

module.exports = { resetCounter };

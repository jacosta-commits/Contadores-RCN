'use strict';

/**
 * Lector Modbus (PLC y CALC) con pool de conexiones.
 * Requiere: npm i modbus-serial
 */

const ModbusRTU = require('modbus-serial');
const logger = require('../../server/lib/logger');

const TCP_TIMEOUT = 5000; // ms (antes 600)
const TCP_RETRIES = 1;
const HOLD_LEN_PLC = 16;  // margen
const READ_TIMEOUT = 5000; // ms (antes 900)

// const pool = new Map(); // Pooling deshabilitado para imitar Contadores_02 y evitar problemas con PLCs mañosos

async function getClient(t) {
  // Crear cliente y conectar (SIEMPRE NUEVO)
  const client = new ModbusRTU();
  client.setTimeout(TCP_TIMEOUT);

  let connected = false;
  for (let i = 0; i <= TCP_RETRIES; i++) {
    try {
      // Pasar timeout en connectTCP también
      await client.connectTCP(t.modbusIP, { port: t.modbusPort || 502, timeout: TCP_TIMEOUT });
      client.setID(t.modbusID || 1);
      connected = true;
      break;
    } catch (e) {
      if (i === TCP_RETRIES) {
        try { await client.close(); } catch (_) { } // Limpiar
        throw e;
      }
    }
  }

  if (!connected) throw new Error('No se pudo conectar Modbus');
  return client;
}

async function readHolding(client, addr, len = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT);
  try {
    const res = await client.readHoldingRegisters(addr, len);
    clearTimeout(timer);
    return res.data || res.buffer;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * PLC: lee base + relativos (definidos en tabla)
 * Espera que el telar tenga:
 * - plc_base_offset, plc_hil_act_rel, plc_velocidad_rel, plc_hil_turno_rel, plc_set_rel, plc_hil_start_rel
 */
async function readPLC(telar) {
  const client = await getClient(telar);

  try {
    const base = telar.holdingOffset; // en VIEW, para PLC es plc_base_offset
    const rels = [
      telar.plc_hil_act_rel ?? 0,
      telar.plc_velocidad_rel ?? 4,
      telar.plc_hil_turno_rel ?? 6,
      telar.plc_set_rel ?? 7,
      telar.plc_hil_start_rel ?? 10,
    ];
    const min = Math.min(...rels);
    const max = Math.max(...rels);
    const len = (max - min) + 1;

    const regs = await readHolding(client, base + min, Math.max(len, HOLD_LEN_PLC));

    const pick = (rel) => regs[(rel - min)] ?? 0;

    const hil_act_raw = pick(rels[0]);
    const velocidad = pick(rels[1]);
    const hil_turno = pick(rels[2]);
    // const set_value = pick(rels[3]); // IGNORAR PLC: La autoridad es la DB (Web UI)
    const hil_start = pick(rels[4]); // Este es el del PLC, pero usamos el nuestro del sync

    // Aplicar offset local si existe (manejado por sync)
    // El 'hil_start' que viene en 'telar' es el que se sincroniza con la DB
    const offset = telar.hil_start || 0;
    const acumOffset = telar.hil_acum_offset || 0;

    // CORRECCIÓN: Para PLC, hil_act es DIRECTAMENTE lo que leemos.
    // El reset se hace por coil en el PLC, así que el RAW vuelve a 0.
    // No usamos offset de software para PLC.
    const hil_act = hil_act_raw;

    // Para PLC, hil_turno y hil_start vienen del PLC (si existen en el mapa)
    // Si no, usamos el cálculo local como fallback, pero la autoridad es el PLC.
    const hil_turno_final = (telar.plc_hil_turno_rel != null) ? hil_turno : Math.max(0, hil_act_raw - offset);
    const hil_start_final = (telar.plc_hil_start_rel != null) ? hil_start : offset;

    if (telar.telarKey === '0069') {
      logger.info({ telcod: telar.telarKey, raw: hil_act_raw, offset, acumOffset, hil_act, hil_turno: hil_turno_final, hil_start: hil_start_final }, '[modbus] PLC Read');
    }

    return {
      mode: 'PLC',
      hil_act,
      hil_act_raw, // Guardamos el raw para usarlo como nuevo offset al resetear
      velocidad,
      hil_turno: hil_turno_final,
      set_value: 0,
      hil_start: hil_start_final,
    };
  } finally {
    try { await client.close(); } catch (_) { }
  }
}

/**
 * Escribe un pulso (True -> wait -> False) en un coil
 */
async function pulseCoil(telar, coilAddr) {
  if (coilAddr === null || coilAddr === undefined) return;
  const client = await getClient(telar);
  try {
    // Escribir TRUE
    await client.writeCoil(coilAddr, true);
    // Esperar un poco (ej. 500ms, igual que Contadores_02)
    await new Promise(r => setTimeout(r, 500));
    // Escribir FALSE
    await client.writeCoil(coilAddr, false);
    logger.info({ telcod: telar.telarKey, coilAddr }, '[modbus] Pulse sent');
  } finally {
    try { await client.close(); } catch (_) { }
  }
}

/**
 * CALC: lee solo 1 registro (pulsos acumulados)
 * En la VIEW, holdingOffset = calc_pulse_offset.
 */
async function readPulse(telar) {
  const client = await getClient(telar);
  try {
    const data = await readHolding(client, telar.holdingOffset, 1);
    const pulse = data?.[0] ?? 0;
    return pulse;
  } finally {
    try { await client.close(); } catch (_) { }
  }
}

/**
 * Escribe un valor en un registro Holding
 */
async function writeRegister(telar, addr, value) {
  if (addr === null || addr === undefined) return;
  const client = await getClient(telar);
  try {
    await client.writeRegister(addr, value);
    logger.info({ telcod: telar.telarKey, addr, value }, '[modbus] Register written');
  } finally {
    try { await client.close(); } catch (_) { }
  }
}

module.exports = { readPLC, readPulse, pulseCoil, writeRegister };

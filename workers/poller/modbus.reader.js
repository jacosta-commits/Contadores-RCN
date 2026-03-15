'use strict';

/**
 * Lector Modbus (PLC y CALC) con pool de conexiones auto-limpiable.
 * Requiere: npm i modbus-serial
 * 
 * ANTI-FREEZE: Cada conexión tiene TTL y último uso. Conexiones viejas
 * o inactivas se cierran automáticamente para evitar sockets zombie.
 */

const ModbusRTU = require('modbus-serial');
const logger = require('../../server/lib/logger');

const TCP_TIMEOUT = 2000;    // Timeout de conexión TCP (ms)
const READ_TIMEOUT = 2000;   // Timeout de lectura Modbus (ms)
const TCP_RETRIES = 0;       // 0 retries para fallar rápido
const HOLD_LEN_PLC = 16;     // Margen de registros PLC

// ── Pool con TTL y limpieza automática ──
const POOL_TTL_MS = 30_000;       // Máximo 30s de vida por conexión
const POOL_IDLE_MS = 15_000;      // Cerrar si no se usa en 15s
const POOL_CLEANUP_MS = 10_000;   // Frecuencia de limpieza automática

/** @type {Map<string, { client: ModbusRTU, createdAt: number, lastUsed: number }>} */
const pool = new Map();

// Limpieza automática del pool cada POOL_CLEANUP_MS
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pool) {
    const tooOld = (now - entry.createdAt) > POOL_TTL_MS;
    const tooIdle = (now - entry.lastUsed) > POOL_IDLE_MS;
    if (tooOld || tooIdle) {
      try { entry.client.close(); } catch (_) { }
      pool.delete(key);
      logger.debug(`[modbus] Pool cleanup: ${key} (${tooOld ? 'TTL' : 'idle'})`);
    }
  }
}, POOL_CLEANUP_MS);

/** Destruir explícitamente una conexión del pool */
function destroyClient(key) {
  const entry = pool.get(key);
  if (entry) {
    try { entry.client.close(); } catch (_) { }
    pool.delete(key);
  }
}

async function getClient(t) {
  const key = `${t.modbusIP}:${t.modbusPort || 502}`;

  // 1. Intentar reutilizar del pool
  if (pool.has(key)) {
    const entry = pool.get(key);
    const now = Date.now();

    // Forzar renovación si la conexión es muy vieja
    if ((now - entry.createdAt) > POOL_TTL_MS) {
      destroyClient(key);
    } else if (entry.client.isOpen) {
      entry.client.setID(t.modbusID || 1);
      entry.lastUsed = now;
      return entry.client;
    } else {
      destroyClient(key);
    }
  }

  // 2. Crear nuevo cliente
  const client = new ModbusRTU();
  client.setTimeout(TCP_TIMEOUT);

  let connected = false;
  for (let i = 0; i <= TCP_RETRIES; i++) {
    try {
      await client.connectTCP(t.modbusIP, { port: t.modbusPort || 502, timeout: TCP_TIMEOUT });
      client.setID(t.modbusID || 1);
      connected = true;
      break;
    } catch (e) {
      if (i === TCP_RETRIES) {
        try { await client.close(); } catch (_) { }
        throw e;
      }
    }
  }

  if (!connected) throw new Error('No se pudo conectar Modbus');

  // 3. Guardar en pool con metadatos
  const now = Date.now();
  pool.set(key, { client, createdAt: now, lastUsed: now });
  return client;
}

async function readHolding(client, addr, len = 1) {
  const readPromise = client.readHoldingRegisters(addr, len);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Modbus Read Timeout')), READ_TIMEOUT)
  );

  try {
    const res = await Promise.race([readPromise, timeoutPromise]);
    return res.data || res.buffer;
  } catch (e) {
    // Si falla por timeout, cerrar el socket zombie
    if (e.message === 'Modbus Read Timeout') {
      // Encontrar y destruir la entrada del pool para este client
      for (const [key, entry] of pool) {
        if (entry.client === client) {
          destroyClient(key);
          break;
        }
      }
    }
    throw e;
  }
}

/**
 * PLC: lee base + relativos (definidos en tabla)
 */
async function readPLC(telar) {
  const client = await getClient(telar);

  const base = telar.holdingOffset;
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
  const hil_start = pick(rels[4]);

  const offset = telar.hil_start || 0;
  const hil_act = hil_act_raw;

  const hil_turno_final = (telar.plc_hil_turno_rel != null) ? hil_turno : Math.max(0, hil_act_raw - offset);
  const hil_start_final = (telar.plc_hil_start_rel != null) ? hil_start : offset;

  return {
    mode: 'PLC',
    hil_act,
    hil_act_raw,
    velocidad,
    hil_turno: hil_turno_final,
    set_value: 0,
    hil_start: hil_start_final,
  };
}

/**
 * Escribe un pulso (True -> wait -> False) en un coil
 */
async function pulseCoil(telar, coilAddr) {
  if (coilAddr === null || coilAddr === undefined) return;
  const client = await getClient(telar);
  try {
    const p1 = client.writeCoil(coilAddr, true);
    const t1 = new Promise((_, r) => setTimeout(() => r(new Error('Modbus Write Timeout')), READ_TIMEOUT));
    await Promise.race([p1, t1]);

    await new Promise(r => setTimeout(r, 500));

    const p2 = client.writeCoil(coilAddr, false);
    const t2 = new Promise((_, r) => setTimeout(() => r(new Error('Modbus Write Timeout')), READ_TIMEOUT));
    await Promise.race([p2, t2]);

    logger.info({ telcod: telar.telarKey, coilAddr }, '[modbus] Pulse sent');
  } catch (e) {
    if (e.message === 'Modbus Write Timeout') {
      const key = `${telar.modbusIP}:${telar.modbusPort || 502}`;
      destroyClient(key);
    }
    throw e;
  }
}

/**
 * CALC: lee solo 1 registro (pulsos acumulados)
 */
async function readPulse(telar) {
  const client = await getClient(telar);
  const data = await readHolding(client, telar.holdingOffset, 1);
  const pulse = data?.[0] ?? 0;
  return pulse;
}

/**
 * Escribe un valor en un registro Holding
 */
async function writeRegister(telar, addr, value) {
  if (addr === null || addr === undefined) return;
  const client = await getClient(telar);
  try {
    const p = client.writeRegister(addr, value);
    const t = new Promise((_, r) => setTimeout(() => r(new Error('Modbus Write Timeout')), READ_TIMEOUT));
    await Promise.race([p, t]);

    logger.info({ telcod: telar.telarKey, addr, value }, '[modbus] Register written');
  } catch (e) {
    if (e.message === 'Modbus Write Timeout') {
      const key = `${telar.modbusIP}:${telar.modbusPort || 502}`;
      destroyClient(key);
    }
    throw e;
  }
}

module.exports = { readPLC, readPulse, pulseCoil, writeRegister };

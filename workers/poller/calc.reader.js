'use strict';

/**
 * Deriva métricas desde pulsos (CALC) usando DELTA acumulado,
 * igual que tu servidor viejo:
 *  - lee el registro raw (contador creciente),
 *  - calcula delta = raw - lastRaw (si < 0 → 0),
 *  - suma delta DIRECTO a hil_act e hil_turno (SIN división).
 */

const logger = require('../../server/lib/logger');

const state = new Map(); // telcod -> { offsetInitialized, lastPulse, lastTs, hil_act, hil_turno, hil_start, set_value, velocidad }

function ensureState(telcod) {
  if (!state.has(telcod)) {
    state.set(telcod, {
      offsetInitialized: false,
      lastPulse: 0,
      lastTs: null,
      hil_act: 0,
      hil_turno: 0,
      hil_start: 0,
      set_value: 0,
      velocidad: 0,
      velocidad: 0,
      session_active: 0,
      lastAcumOffset: undefined,
    });
  }
  return state.get(telcod);
}

/**
 * Siembras estado desde el recovery (RCN_CONT_CACHE),
 * igual que hacías antes con node-persist.
 */
function seedFromCache(params) {
  const { telcod } = params;
  const s = ensureState(telcod);
  if (params.hil_act !== undefined) s.hil_act = Number(params.hil_act);
  if (params.hil_turno !== undefined) s.hil_turno = Number(params.hil_turno);
  if (params.hil_start !== undefined) s.hil_start = Number(params.hil_start);
  if (params.set_value !== undefined) s.set_value = Number(params.set_value);
  if (params.session_active !== undefined) s.session_active = Number(params.session_active);
}

/**
 * CALC a partir del registro raw:
 *  - Primer llamado: solo inicializa lastPulse y NO toca los contadores
 *    (se quedan con lo que vino del cache o 0).
 *  - Siguientes: delta = pulse - lastPulse, si <0 → 0.
 *  - hil_act += delta (SIN división, pulso por pulso)
 *  - hil_turno += delta (SIN división, pulso por pulso)
 *  - velocidad: pulsos/minuto.
 */
function computeFromPulse({ telar, pulse, ts, pulsesPerRow = 1 }) {
  const telcod = telar.telarKey;
  const s = ensureState(telcod);
  const now = ts || new Date();
  const p = Number(pulse) || 0;

  // Primera lectura: sólo baseline de pulse, no movemos contadores
  if (!s.offsetInitialized) {
    s.lastPulse = p;
    s.lastTs = now;
    s.offsetInitialized = true;
    if (logger && logger.debug) {
      logger.debug(`[calc] init CALC telar=${telcod} basePulse=${p}`);
    }
    return {
      mode: 'CALC',
      hil_act: s.hil_act,
      hil_turno: s.hil_turno,
      hil_start: s.hil_start,
      set_value: s.set_value,
      velocidad: s.velocidad,
    };
  }

  // Delta de pulsos
  let dp = p - s.lastPulse;
  if (dp < 0) {
    // igual que en tu código viejo: si el contador se resetea, no restamos nada
    dp = 0;
  }
  s.lastPulse = p;

  // SIN DIVISIÓN - suma el delta directo (igual que App_RCN_web_con_PLC)
  // Esto cuenta PULSO POR PULSO, no por hileras
  const dPulses = dp;  // delta de pulsos, sin división

  // Velocidad (pulsos/minuto)
  const dt = (now - (s.lastTs || now)) / 1000;
  if (dt > 0 && dPulses >= 0) {
    const vel_pps = dPulses / dt;   // pulses per second
    s.velocidad = Math.round(vel_pps * 60); // pulses per minute
  }
  s.lastTs = now;

  // Acumulados en memoria (SIN división, igual que tu servidor viejo)
  s.hil_act += dPulses;
  s.hil_turno += dPulses; // RESTAURADO: Acumular delta independientemente

  // NEW: Ajuste por cambio de hil_acum_offset (Reset desde Supervisor)
  const currentOffset = telar.hil_acum_offset || 0;
  if (s.lastAcumOffset === undefined) {
    s.lastAcumOffset = currentOffset;
  } else if (s.lastAcumOffset !== currentOffset) {
    const diff = currentOffset - s.lastAcumOffset;
    logger.info(`[calc] RESET DETECTED for ${telcod}: hil_act=${s.hil_act}, currentOffset=${currentOffset}, lastOffset=${s.lastAcumOffset}, diff=${diff}`);
    s.hil_act = Math.max(0, s.hil_act - diff);
    s.lastAcumOffset = currentOffset;
    logger.info(`[calc] RESET RESULT for ${telcod}: New hil_act=${s.hil_act}`);
  }

  // ELIMINADO: No derivar hil_turno de hil_act para evitar que el reset de ACUM afecte al TURNO
  // s.hil_turno = Math.max(0, s.hil_act - s.hil_start);

  // NEW: Derivar hil_turno de hil_start (que se sincroniza con el servidor)
  // ELIMINADO: Esto acoplaba hil_turno a hil_act, impidiendo resetear hil_act sin afectar hil_turno.
  // s.hil_turno = s.hil_act - s.hil_start;
  // if (s.hil_turno < 0) s.hil_turno = 0; 

  return {
    mode: 'CALC',
    hil_act: s.hil_act,       // SIN Math.floor para precisión exacta
    hil_turno: s.hil_turno,   // SIN Math.floor
    hil_start: s.hil_start,   // SIN Math.floor
    set_value: s.set_value,   // Devolver valor en memoria (se actualiza por sync)
    velocidad: s.velocidad,
    session_active: s.session_active,
  };
}

function getState(telcod) {
  return state.get(telcod);
}

module.exports = { seedFromCache, computeFromPulse, getState };

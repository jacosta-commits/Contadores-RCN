'use strict';

/**
 * TelarCounter — Encapsula TODO el estado de un telar individual.
 *
 * Reemplaza: calc.reader.js (Map interna) + parte de persistence.js (state, lastServerState)
 * Cada instancia es independiente: un error en un telar no afecta a otros.
 *
 * Lógica idéntica a la procedural anterior, solo reorganizada.
 */

const logger = require('../../server/lib/logger');

class TelarCounter {
    /**
     * @param {string} telcod
     * @param {string} mode - 'PLC' | 'CALC'
     */
    constructor(telcod, mode = 'CALC') {
        this.telcod = telcod;
        this.mode = mode;

        // --- Contadores ---
        this.hil_act = 0;
        this.hil_turno = 0;
        this.hil_start = 0;
        this.set_value = 0;
        this.velocidad = 0;

        // --- CALC: pulse tracking ---
        this.offsetInitialized = false;
        this.lastPulse = 0;
        this.lastTs = null;
        this.lastAcumOffset = undefined;

        // --- Sesión ---
        this.session_active = 0;
        this.sescod = null;
        this.tracod = null;
        this.traraz = null;
        this.turno_cod = null;
        this.inicio_dt = null;

        // --- Persistence tracking ---
        this.ts = Date.now();
        this.dirty = false;
        this.lastSync = Date.now();   // Prevent startup sync flood
        this._fromDisk = false;       // Flag to know if loaded from disk
        this._lastServerState = {};   // Authoritative DB baseline
    }

    // ─────────────────────────────────────────────────────────────
    //  SEEDING (from disk / DB recovery)
    // ─────────────────────────────────────────────────────────────

    /**
     * Seed counter state from recovery data (disk or DB).
     * Only sets fields that are present in the params.
     */
    seed(params) {
        if (params.hil_act !== undefined) this.hil_act = Number(params.hil_act);
        if (params.hil_turno !== undefined) this.hil_turno = Number(params.hil_turno);
        if (params.hil_start !== undefined) this.hil_start = Number(params.hil_start);
        if (params.set_value !== undefined) this.set_value = Number(params.set_value);
        if (params.session_active !== undefined) this.session_active = Number(params.session_active);
        if (params.hil_acum_offset !== undefined) this.lastAcumOffset = Number(params.hil_acum_offset);

        // Session metadata
        if (params.sescod !== undefined) this.sescod = params.sescod;
        if (params.tracod !== undefined) this.tracod = params.tracod;
        if (params.traraz !== undefined) this.traraz = params.traraz;
        if (params.turno_cod !== undefined) this.turno_cod = params.turno_cod;
        if (params.inicio_dt !== undefined) this.inicio_dt = params.inicio_dt;

        this.ts = Date.now();
        this.dirty = true;
    }

    /**
     * Initialize the server state baseline.
     * @param {object} srvData - Data from DB or disk
     * @param {boolean} fromDisk - Mark as loaded from disk (prevents false reset detection)
     */
    initServerState(srvData, fromDisk = false) {
        this._lastServerState = { ...srvData };
        if (fromDisk) {
            this._lastServerState._fromDisk = true;
            this._fromDisk = true;
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  CALC: Pulse Processing (from calc.reader.js computeFromPulse)
    // ─────────────────────────────────────────────────────────────

    /**
     * Process a CALC pulse reading. IDENTICAL logic to old computeFromPulse.
     * @param {number} rawPulse - Raw pulse value from Modbus register
     * @param {object} telarMap - Live telar map entry (has hil_acum_offset)
     * @returns {object} snapshot
     */
    processPulse(rawPulse, telarMap) {
        const p = Number(rawPulse) || 0;

        // Primera lectura: sólo baseline, no movemos contadores
        if (!this.offsetInitialized) {
            this.lastPulse = p;
            this.lastTs = new Date();
            // CRITICAL: Establish offset baseline from LIVE telar map
            this.lastAcumOffset = telarMap.hil_acum_offset || 0;
            this.offsetInitialized = true;
            logger.debug(`[counter] init CALC telar=${this.telcod} basePulse=${p} baseOffset=${this.lastAcumOffset}`);
            return this.toSnapshot();
        }

        // Delta de pulsos
        let dp = p - this.lastPulse;
        if (dp < 0) dp = 0;  // Counter wrapped → ignore
        this.lastPulse = p;

        // Acumulados (SIN división, pulso por pulso)
        this.hil_act += dp;
        this.hil_turno += dp;

        // CALC no tiene sensor de velocidad
        this.velocidad = 0;

        // Ajuste por cambio de hil_acum_offset (Reset desde Supervisor)
        const currentOffset = telarMap.hil_acum_offset || 0;
        if (this.lastAcumOffset !== currentOffset) {
            const diff = currentOffset - this.lastAcumOffset;
            logger.info(`[counter] RESET DETECTED ${this.telcod}: hil_act=${this.hil_act}, offset=${currentOffset}, lastOffset=${this.lastAcumOffset}, diff=${diff}`);
            this.hil_act = Math.max(0, this.hil_act - diff);
            this.lastAcumOffset = currentOffset;
            logger.info(`[counter] RESET RESULT ${this.telcod}: hil_act=${this.hil_act}`);
        }

        this.ts = Date.now();
        this.dirty = true;
        return this.toSnapshot();
    }

    // ─────────────────────────────────────────────────────────────
    //  PLC: Direct Reading
    // ─────────────────────────────────────────────────────────────

    /**
     * Process a PLC reading. PLC values come directly from hardware.
     * @param {object} plcData - { hil_act, hil_turno, velocidad, hil_start, set_value, hil_act_raw }
     */
    processPLC(plcData) {
        this.hil_act = plcData.hil_act ?? this.hil_act;
        this.hil_turno = plcData.hil_turno ?? this.hil_turno;
        this.velocidad = plcData.velocidad ?? this.velocidad;
        // hil_start for PLC comes from the PLC or from sync
        if (plcData.hil_start !== undefined) this.hil_start = plcData.hil_start;
        // set_value not from PLC (authority is DB)

        this.ts = Date.now();
        this.dirty = true;
        return this.toSnapshot();
    }

    // ─────────────────────────────────────────────────────────────
    //  Actions (SET, RESET, SESSION)
    // ─────────────────────────────────────────────────────────────

    /**
     * Reset HIL ACUM to 0 (from Supervisor double-tap).
     * ONLY resets hil_act, NOT hil_turno.
     * @param {number} newOffset - New hil_acum_offset value
     */
    resetAcum(newOffset) {
        logger.info(`[counter] resetAcum ${this.telcod}: hil_act=${this.hil_act} → 0, offset=${newOffset}`);
        this.hil_act = 0;
        this.lastAcumOffset = newOffset;
        this.offsetInitialized = false;  // Force re-init on next processPulse
        this.ts = Date.now();
        this.dirty = true;

        // Update server state baseline
        this._lastServerState.hil_act = 0;
        this._lastServerState.hil_acum_offset = newOffset;
    }

    /**
     * Update SET value (from Operator double-tap).
     * @param {number} val
     */
    setSetValue(val) {
        this.set_value = Number(val) || 0;
        this.ts = Date.now();
        this.dirty = true;
        this._lastServerState.set_value = this.set_value;
    }

    /**
     * Open session (Operator starts working).
     */
    openSession({ sescod, tracod, traraz, turno_cod, hil_start, set_value }) {
        logger.info(`[counter] openSession ${this.telcod}: sescod=${sescod}`);
        this.session_active = 1;
        this.sescod = sescod;
        this.tracod = tracod;
        this.traraz = traraz;
        this.turno_cod = turno_cod;
        if (hil_start !== undefined) this.hil_start = hil_start;
        if (set_value !== undefined) this.set_value = set_value;
        this.ts = Date.now();
        this.dirty = true;

        // Update server state
        Object.assign(this._lastServerState, {
            session_active: 1, sescod, tracod, traraz, turno_cod,
            hil_start: this.hil_start, set_value: this.set_value,
        });
    }

    /**
     * Close session (Operator stops working).
     * Resets hil_turno by setting hil_start = current hil_act.
     * @param {number} newHilStart
     */
    closeSession(newHilStart) {
        logger.info(`[counter] closeSession ${this.telcod}: newHilStart=${newHilStart}`);
        this.session_active = 0;
        this.sescod = null;
        this.tracod = null;
        this.traraz = null;
        this.turno_cod = null;
        this.inicio_dt = null;
        this.hil_start = newHilStart;
        this.hil_turno = 0;
        this.ts = Date.now();
        this.dirty = true;

        // Update server state
        Object.assign(this._lastServerState, {
            session_active: 0, sescod: null, tracod: null, traraz: null,
            turno_cod: null, inicio_dt: null, hil_start: newHilStart,
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  Sync with DB (from persistence.js)
    // ─────────────────────────────────────────────────────────────

    /**
     * Sync authoritative fields FROM the DB (sessions, resets, hil_start, set_value).
     * Counter values (hil_act, hil_turno) are NOT overwritten — poller is authoritative.
     * @param {object} srv - Server state from DB
     * @returns {boolean} true if any change was applied
     */
    syncFromServer(srv) {
        const last = this._lastServerState;
        let changed = false;

        // 1. Update server baseline
        this._lastServerState = { ...srv };

        // 2. Detect Session Changes (Server is authority)
        if (srv.session_active !== this.session_active) {
            this.session_active = srv.session_active;
            this.sescod = srv.sescod;
            this.tracod = srv.tracod;
            this.traraz = srv.traraz;
            this.turno_cod = srv.turno_cod;
            this.inicio_dt = srv.inicio_dt || this.inicio_dt;
            changed = true;
        }

        // 3. Detect hil_start changes (shift reset)
        if (srv.hil_start !== undefined && srv.hil_start !== this.hil_start) {
            this.hil_start = srv.hil_start;
            this.hil_turno = Math.max(0, this.hil_act - srv.hil_start);
            changed = true;
        }

        // 4. Detect Manual Counter Reset (Server 0, Local > 0)
        // ONLY if previous baseline came from a real DB sync (not from disk)
        if (srv.hil_act === 0 && this.hil_act > 0 && !last._fromDisk) {
            this.hil_act = 0;
            this.hil_turno = 0;
            changed = true;
        }

        // 5. Sync set_value
        if (srv.set_value !== undefined) {
            this.set_value = srv.set_value;
        }

        if (changed) {
            this.ts = Date.now();
            this.dirty = true;
        }
        return changed;
    }

    /**
     * Build the server sync result (mock or real) for the poller cycle.
     * Returns session metadata fields from the server baseline.
     */
    getServerState() {
        return {
            session_active: this._lastServerState.session_active ?? this.session_active,
            hil_start: this._lastServerState.hil_start ?? this.hil_start,
            set_value: this._lastServerState.set_value ?? this.set_value,
            hil_acum_offset: this._lastServerState.hil_acum_offset,
            tracod: this._lastServerState.tracod,
            traraz: this._lastServerState.traraz,
            turno_cod: this._lastServerState.turno_cod,
            inicio_dt: this._lastServerState.inicio_dt,
            updated_at: this._lastServerState.updated_at,
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  Serialization
    // ─────────────────────────────────────────────────────────────

    /**
     * Snapshot for WS broadcast (identical format to old system).
     */
    toSnapshot() {
        return {
            mode: this.mode,
            hil_act: this.hil_act,
            hil_turno: this.hil_turno,
            hil_start: this.hil_start,
            set_value: this.set_value,
            velocidad: this.velocidad,
            session_active: this.session_active,
            sescod: this.sescod,
            tracod: this.tracod,
            traraz: this.traraz,
            turno_cod: this.turno_cod,
            inicio_dt: this.inicio_dt,
        };
    }

    /**
     * Full state for state.json serialization (persistence).
     */
    toJSON() {
        return {
            telcod: this.telcod,
            mode: this.mode,
            hil_act: this.hil_act,
            hil_turno: this.hil_turno,
            hil_start: this.hil_start,
            set_value: this.set_value,
            velocidad: this.velocidad,
            session_active: this.session_active,
            sescod: this.sescod,
            tracod: this.tracod,
            traraz: this.traraz,
            turno_cod: this.turno_cod,
            inicio_dt: this.inicio_dt,
            ts: this.ts,
        };
    }

    /**
     * Restore state from a state.json entry.
     */
    static fromJSON(data) {
        const c = new TelarCounter(data.telcod, data.mode || 'CALC');
        c.seed(data);
        c.ts = data.ts || Date.now();
        return c;
    }
}

module.exports = TelarCounter;

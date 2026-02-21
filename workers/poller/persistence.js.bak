'use strict';

const fs = require('fs');
const path = require('path');
const { upsertCache } = require('./cache.sync');
const logger = require('../../server/lib/logger');
const bridge = require('../../server/lib/poller-bridge');

const STATE_FILE = path.join(__dirname, 'state.json');
const SYNC_INTERVAL = 5000; // 5s (reduced from 15s — bridge handles critical updates instantly)

let state = {};
let lastServerState = {};
let lastSync = {};
let lastDiskWrite = 0;
let dirty = new Set();

/** Load state from disk on startup */
function load() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            state = JSON.parse(raw);
            logger.info(`[persistence] Loaded ${Object.keys(state).length} items from disk`);
            return Object.values(state);
        }
    } catch (e) {
        logger.error('[persistence] Load failed', e);
    }
    return [];
}

/**
 * Initialize state from external source (DB or Disk)
 * Populates lastServerState to avoid "0 session" issue
 * Sets lastSync to NOW to prevent startup flood
 */
function initState(items) {
    const now = Date.now();
    items.forEach(item => {
        const telcod = item.telcod;
        // Update local state
        state[telcod] = { ...state[telcod], ...item, ts: now };

        // Update server state baseline (CRITICAL for session display)
        // Mark as _fromDisk so syncFromDB won't falsely detect resets
        lastServerState[telcod] = { ...item, _fromDisk: true };

        // Prevent immediate sync flood
        lastSync[telcod] = now;

        dirty.add(telcod);
    });
    logger.info(`[persistence] Initialized ${items.length} items. Sync deferred.`);

    // Subscribe to bridge events for instant notification
    _subscribeBridge();
}

/** 
 * Process a telar update:
 * 1. Update local state
 * 2. Save to disk (throttled 1s)
 * 3. Sync to DB (throttled 15s or critical)
 */
async function process(API_BASE, payload) {
    const telcod = payload.telcod;
    const now = Date.now();

    // 1. Update local state
    state[telcod] = { ...state[telcod], ...payload, ts: now };
    dirty.add(telcod);

    // 2. Disk Write (Global throttle 1s)
    if (now - lastDiskWrite > 1000 && dirty.size > 0) {
        try {
            const temp = STATE_FILE + '.tmp';
            fs.writeFileSync(temp, JSON.stringify(state, null, 2));
            fs.renameSync(temp, STATE_FILE);
            lastDiskWrite = now;
        } catch (e) {
            logger.warn('[persistence] Disk write failed:', e.message);
        }
    }

    // 3. DB Sync Logic
    // Critical check: Session change or Reset (hil_act dropped to 0)
    // Note: We use lastServerState to compare, because payload is what we WANT to save.
    const lastSrv = lastServerState[telcod] || {};

    const sessionChanged = (
        payload.session_active !== undefined &&
        lastSrv.session_active !== undefined &&
        lastSrv.session_active !== payload.session_active
    );
    // Reset: If server has > 0 and we have 0 (and mode is CALC, usually)
    const resetDetected = (lastSrv.hil_act > 0 && payload.hil_act === 0);

    const timeToSync = (now - (lastSync[telcod] || 0) > SYNC_INTERVAL);

    if (sessionChanged || resetDetected || timeToSync) {
        // SYNC NOW
        try {
            const res = await upsertCache(API_BASE, payload);
            if (res?.data) {
                lastServerState[telcod] = res.data;
            }
            lastSync[telcod] = now;
            dirty.delete(telcod);
            return res; // Return REAL server state
        } catch (e) {
            logger.warn(`[persistence] Sync failed for ${telcod}: ${e.message}`);
            // Fallback: return cached server state to avoid breaking poller logic
            return { data: lastSrv };
        }
    }

    // NO SYNC: Return MOCK server state
    // We must return what we *expect* the server to have, plus what the server controls.
    return {
        data: {
            ...payload, // Assume server accepted our counters
            // Override with authoritative server fields if we have them
            session_active: lastSrv.session_active ?? payload.session_active,
            hil_start: lastSrv.hil_start ?? payload.hil_start,
            set_value: lastSrv.set_value ?? payload.set_value,
            // Session metadata (CRITICAL: preserve inicio_dt)
            tracod: lastSrv.tracod,
            traraz: lastSrv.traraz,
            turno_cod: lastSrv.turno_cod,
            inicio_dt: lastSrv.inicio_dt,
            // hil_turno: lastSrv.hil_turno ?? payload.hil_turno, // No, we want local calc
            updated_at: lastSrv.updated_at || new Date().toISOString()
        }
    };
}

/**
 * Merge fresh server state (from periodic polling) into local state.
 * Updates sessions and detects resets, but preserves local counters.
 */
function syncFromDB(items) {
    const now = Date.now();
    let updates = 0;

    items.forEach(srv => {
        const telcod = srv.telcod;
        const local = state[telcod] || {};
        const last = lastServerState[telcod] || {};

        // 1. Update authoritative baseline
        lastServerState[telcod] = { ...srv };

        // 2. Detect Session Changes (Server is authority)
        if (srv.session_active !== local.session_active) {
            state[telcod] = {
                ...state[telcod],
                session_active: srv.session_active,
                sescod: srv.sescod,
                tracod: srv.tracod,
                traraz: srv.traraz,
                turno_cod: srv.turno_cod,
                // PRESERVE inicio_dt if not provided (pullRecovery doesn't include it)
                inicio_dt: srv.inicio_dt || local.inicio_dt,
                ts: now
            };
            updates++;
        }

        // 3. Detect Resets (Server hil_start changed)
        if (srv.hil_start !== undefined && srv.hil_start !== local.hil_start) {
            // Reset detected
            state[telcod] = {
                ...state[telcod],
                hil_start: srv.hil_start,
                hil_turno: Math.max(0, (local.hil_act || 0) - srv.hil_start),
                ts: now
            };
            updates++;
        }

        // 4. Detect Manual Counter Reset (Server 0, Local > 0)
        // ONLY if previous baseline came from a real DB sync (not from disk)
        // Otherwise on restart, DB may not have been updated yet → false reset
        if (srv.hil_act === 0 && (local.hil_act || 0) > 0 && !last._fromDisk) {
            state[telcod] = {
                ...state[telcod],
                hil_act: 0,
                hil_turno: 0,
                ts: now
            };
            updates++;
        }
    });

    if (updates > 0) {
        logger.info(`[persistence] Synced ${updates} updates from DB (Sessions/Resets)`);
    }
}

function getState() {
    return state;
}

/** Flag to avoid double-subscribing */
let _bridgeSubscribed = false;

/** Subscribe to in-process bridge events for instant state updates */
function _subscribeBridge() {
    if (_bridgeSubscribed) return;
    _bridgeSubscribed = true;

    bridge.on('session.closed', ({ telcod, sescod, newHilStart, session_active }) => {
        const now = Date.now();
        logger.info(`[persistence] BRIDGE: session.closed telcod=${telcod}`);
        state[telcod] = {
            ...state[telcod],
            session_active: 0,
            sescod: null,
            tracod: null,
            traraz: null,
            turno_cod: null,
            inicio_dt: null,
            hil_start: newHilStart,
            hil_turno: 0,
            ts: now,
        };
        lastServerState[telcod] = {
            ...lastServerState[telcod],
            session_active: 0,
            sescod: null,
            tracod: null,
            traraz: null,
            turno_cod: null,
            inicio_dt: null,
            hil_start: newHilStart,
        };
        dirty.add(telcod);
    });

    bridge.on('session.opened', ({ telcod, sescod, tracod, traraz, turno_cod, session_active, hil_act, hil_turno, hil_start, set_value }) => {
        const now = Date.now();
        logger.info(`[persistence] BRIDGE: session.opened telcod=${telcod} sescod=${sescod}`);
        state[telcod] = {
            ...state[telcod],
            session_active: 1,
            sescod,
            tracod,
            traraz,
            turno_cod,
            hil_act: hil_act ?? state[telcod]?.hil_act ?? 0,
            hil_turno: hil_turno ?? state[telcod]?.hil_turno ?? 0,
            hil_start: hil_start ?? state[telcod]?.hil_start ?? 0,
            set_value: set_value ?? state[telcod]?.set_value ?? 0,
            ts: now,
        };
        lastServerState[telcod] = {
            ...lastServerState[telcod],
            session_active: 1,
            sescod,
            tracod,
            traraz,
            turno_cod,
            hil_start: hil_start ?? lastServerState[telcod]?.hil_start ?? 0,
            set_value: set_value ?? lastServerState[telcod]?.set_value ?? 0,
        };
        dirty.add(telcod);
    });

    bridge.on('counter.reset', ({ telcod, hil_acum_offset, mode }) => {
        const now = Date.now();
        logger.info(`[persistence] BRIDGE: counter.reset telcod=${telcod} offset=${hil_acum_offset} mode=${mode}`);
        state[telcod] = {
            ...state[telcod],
            hil_act: 0,
            hil_acum_offset: hil_acum_offset,
            ts: now,
        };
        lastServerState[telcod] = {
            ...lastServerState[telcod],
            hil_act: 0,
            hil_acum_offset: hil_acum_offset,
        };
        // CRITICAL: Also update calc.reader's internal state so next computeFromPulse
        // doesn't overwrite persistence state with old hil_act value
        try {
            const { seedFromCache } = require('./calc.reader');
            seedFromCache({ telcod, hil_act: 0, hil_acum_offset: hil_acum_offset, _resetBaseline: true });
        } catch (e) {
            logger.warn(`[persistence] Failed to seed calc reader on reset: ${e.message}`);
        }
        dirty.add(telcod);
    });

    bridge.on('set.updated', ({ telcod, set_value }) => {
        logger.info(`[persistence] BRIDGE: set.updated telcod=${telcod} set_value=${set_value}`);
        state[telcod] = {
            ...state[telcod],
            set_value: set_value,
        };
        lastServerState[telcod] = {
            ...lastServerState[telcod],
            set_value: set_value,
        };
        // Update calc.reader too
        try {
            const { seedFromCache } = require('./calc.reader');
            seedFromCache({ telcod, set_value: set_value });
        } catch (e) {
            logger.warn(`[persistence] Failed to seed calc reader on set: ${e.message}`);
        }
        dirty.add(telcod);
    });

    logger.info('[persistence] Bridge events subscribed');
}

module.exports = { load, process, initState, syncFromDB, getState };

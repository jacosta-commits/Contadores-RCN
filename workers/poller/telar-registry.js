'use strict';

/**
 * TelarRegistry — Singleton que gestiona la colección de TelarCounter.
 *
 * Reemplaza: persistence.js (load, save, initState, syncFromDB, process)
 * Mantiene: disk write throttle (1s), DB sync throttle (5s), bridge handlers.
 */

const fs = require('fs');
const path = require('path');
const TelarCounter = require('./telar-counter');
const { upsertCache } = require('./cache.sync');
const logger = require('../../server/lib/logger');
const bridge = require('../../server/lib/poller-bridge');

const STATE_FILE = path.join(__dirname, 'state.json');
const SYNC_INTERVAL = 5000;    // DB sync throttle per telar
const DISK_INTERVAL = 1000;    // Disk write throttle (global)

class TelarRegistry {
    constructor() {
        /** @type {Map<string, TelarCounter>} */
        this.counters = new Map();
        this._lastDiskWrite = 0;
        this._bridgeSubscribed = false;
    }

    // ─────────────────────────────────────────────────────────────
    //  Access
    // ─────────────────────────────────────────────────────────────

    /**
     * Get or create a counter for a telcod.
     * @param {string} telcod
     * @param {string} [mode='CALC']
     * @returns {TelarCounter}
     */
    get(telcod, mode = 'CALC') {
        if (!this.counters.has(telcod)) {
            this.counters.set(telcod, new TelarCounter(telcod, mode));
        }
        return this.counters.get(telcod);
    }

    /** @returns {TelarCounter[]} */
    getAll() {
        return Array.from(this.counters.values());
    }

    get size() {
        return this.counters.size;
    }

    // ─────────────────────────────────────────────────────────────
    //  Loading (from disk / DB)
    // ─────────────────────────────────────────────────────────────

    /**
     * Load state from disk (state.json). Returns number of items loaded.
     */
    loadFromDisk() {
        try {
            if (!fs.existsSync(STATE_FILE)) return 0;
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            const data = JSON.parse(raw);
            const entries = Object.entries(data);

            for (const [telcod, item] of entries) {
                const counter = this.get(telcod, item.mode || 'CALC');
                counter.seed(item);
                counter.initServerState(item, true); // Mark as from disk
            }

            logger.info(`[registry] Loaded ${entries.length} items from disk`);
            return entries.length;
        } catch (e) {
            logger.error('[registry] Load from disk failed', e);
            return 0;
        }
    }

    /**
     * Load state from DB recovery rows.
     * @param {object[]} records - From VW_RCN_CONT_RECOVERY
     */
    loadFromDB(records) {
        for (const r of records) {
            const counter = this.get(r.telcod, 'CALC'); // mode will be set by map
            counter.seed({
                hil_act: r.hil_act,
                hil_turno: r.hil_turno,
                hil_start: r.hil_start,
                set_value: r.set_value,
                session_active: r.session_active,
                sescod: r.sescod,
                tracod: r.tracod,
                traraz: r.traraz,
                turno_cod: r.turno_cod,
                hil_acum_offset: r.hil_acum_offset,
            });
            counter.initServerState(r, false);
        }
        logger.info(`[registry] Loaded ${records.length} items from DB`);
    }

    // ─────────────────────────────────────────────────────────────
    //  Persistence: Disk + DB Write-Behind
    // ─────────────────────────────────────────────────────────────

    /**
     * Save ALL state to disk (throttled, atomic write).
     */
    saveToDisk() {
        const now = Date.now();
        if (now - this._lastDiskWrite < DISK_INTERVAL) return;

        try {
            const out = {};
            for (const [telcod, counter] of this.counters) {
                out[telcod] = counter.toJSON();
            }
            const temp = STATE_FILE + '.tmp';
            fs.writeFileSync(temp, JSON.stringify(out, null, 2));
            fs.renameSync(temp, STATE_FILE);
            this._lastDiskWrite = now;
        } catch (e) {
            logger.warn('[registry] Disk write failed:', e.message);
        }
    }

    /**
     * Sync a single counter to DB via upsertCache (throttled).
     * @param {TelarCounter} counter
     * @param {object} telarMap - The telar map entry (for last_offset)
     * @returns {object|null} server response data
     */
    async syncToDB(counter, telarMap) {
        const now = Date.now();
        const telcod = counter.telcod;

        // Check if time to sync
        const lastSrv = counter._lastServerState;
        const resetDetected = (lastSrv.hil_act > 0 && counter.hil_act === 0);
        const sessionChanged = (
            lastSrv.session_active !== undefined &&
            lastSrv.session_active !== counter.session_active
        );
        const timeToSync = (now - counter.lastSync > SYNC_INTERVAL);

        if (!sessionChanged && !resetDetected && !timeToSync) {
            // No sync needed: return mock server state
            return null;
        }

        // SYNC NOW
        try {
            const payload = {
                telcod,
                hil_act: counter.hil_act,
                hil_turno: counter.hil_turno,
                velocidad: counter.velocidad,
                last_offset: telarMap?.hil_acum_offset || 0,
                counters_only: true,
            };

            const res = await upsertCache(null, payload);
            if (res?.data) {
                counter._lastServerState = res.data;
            }
            counter.lastSync = now;
            counter.dirty = false;
            return res?.data || null;
        } catch (e) {
            logger.warn(`[registry] DB sync failed for ${telcod}: ${e.message}`);
            return null;
        }
    }

    /**
     * Sync FROM DB (periodic): session changes, resets, hil_start.
     * @param {object[]} items - Recovery rows from DB
     * @returns {number} number of updates applied
     */
    syncFromDB(items) {
        let updates = 0;
        for (const srv of items) {
            const counter = this.counters.get(srv.telcod);
            if (!counter) continue;
            if (counter.syncFromServer(srv)) {
                updates++;
            }
        }
        if (updates > 0) {
            logger.info(`[registry] Synced ${updates} updates from DB (Sessions/Resets)`);
        }
        return updates;
    }

    // ─────────────────────────────────────────────────────────────
    //  Bridge Events
    // ─────────────────────────────────────────────────────────────

    /**
     * Subscribe to bridge events. Called once after loading.
     * @param {Function} getMapEntry - Function to get the telar map entry by telcod
     */
    subscribeBridge(getMapEntry) {
        if (this._bridgeSubscribed) return;
        this._bridgeSubscribed = true;

        bridge.on('counter.reset', ({ telcod, hil_acum_offset, mode }) => {
            logger.info(`[registry] BRIDGE: counter.reset telcod=${telcod} offset=${hil_acum_offset}`);
            const counter = this.counters.get(telcod);
            if (counter) {
                counter.resetAcum(hil_acum_offset);
            }
            // Also update the in-memory telar map
            const mapEntry = getMapEntry(telcod);
            if (mapEntry) {
                mapEntry.hil_acum_offset = hil_acum_offset;
            }
        });

        bridge.on('set.updated', ({ telcod, set_value }) => {
            logger.info(`[registry] BRIDGE: set.updated telcod=${telcod} set_value=${set_value}`);
            const counter = this.counters.get(telcod);
            if (counter) {
                counter.setSetValue(set_value);
            }
        });

        bridge.on('session.opened', ({ telcod, sescod, tracod, traraz, turno_cod, hil_start, set_value }) => {
            logger.info(`[registry] BRIDGE: session.opened telcod=${telcod} sescod=${sescod}`);
            const counter = this.counters.get(telcod);
            if (counter) {
                counter.openSession({ sescod, tracod, traraz, turno_cod, hil_start, set_value });
            }
        });

        bridge.on('session.closed', ({ telcod, newHilStart }) => {
            logger.info(`[registry] BRIDGE: session.closed telcod=${telcod}`);
            const counter = this.counters.get(telcod);
            if (counter) {
                counter.closeSession(newHilStart);
            }
        });

        logger.info('[registry] Bridge events subscribed');
    }
}

// ─────────────────────────────────────────────────────────────
//  Singleton
// ─────────────────────────────────────────────────────────────
const registry = new TelarRegistry();

module.exports = registry;

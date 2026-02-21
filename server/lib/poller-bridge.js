'use strict';

/**
 * poller-bridge.js — In-process EventEmitter for instant server→poller notification.
 *
 * Events:
 *   'session.closed'  { telcod, sescod, newHilStart }
 *   'session.opened'  { telcod, sescod, tracod, traraz, turno_cod, hil_act, hil_turno, hil_start, set_value }
 *   'counter.reset'   { telcod, hil_acum_offset, mode }
 *   'hil_start.changed' { telcod, hil_start }
 */

const { EventEmitter } = require('events');

const bridge = new EventEmitter();
bridge.setMaxListeners(20); // allow multiple subscribers

module.exports = bridge;

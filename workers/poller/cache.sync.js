'use strict';

/**
 * cache.sync.js — Direct DAL access for cache sync.
 * The poller runs in-process, so we call DAL/service directly
 * instead of HTTP fetch to localhost.
 */

const cacheDAL = require('../../server/dal/cache.dal');
const cacheSvc = require('../../server/services/cache.service');
const logger = require('../../server/lib/logger');

async function pullRecovery(_API_BASE) {
  try {
    const data = await cacheDAL.getRecovery();
    return data || [];
  } catch (e) {
    logger.warn(`[cache.sync] pullRecovery direct failed: ${e.message}`);
    throw e;
  }
}

async function upsertCache(_API_BASE, body) {
  try {
    const data = await cacheSvc.upsert(body);
    return { data };
  } catch (e) {
    logger.warn(`[cache.sync] upsertCache direct failed: ${e.message}`);
    throw e;
  }
}

module.exports = { pullRecovery, upsertCache };

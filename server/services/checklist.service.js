'use strict';

const logger = require('../lib/logger').child({ mod: 'checklist.service' });
const chkDAL = require('../dal/checklist.dal');

/** Upsert único por (sescod, telcod) */
async function upsert({ sescod, telcod, tracod = null, items = {} }) {
  return chkDAL.upsert({ sescod, telcod, tracod, items });
}

/** Obtener checklist por (sescod, telcod) */
async function get({ sescod, telcod }) {
  return chkDAL.get({ sescod, telcod });
}

module.exports = { upsert, get };

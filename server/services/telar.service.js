'use strict';

const logger = require('../lib/logger').child({ mod: 'telar.service' });
const telaresDAL = require('../dal/telares.dal');

/** Lista catálogo de telares con filtros */
async function listAll({ grupo = null, activos = true } = {}) {
  return telaresDAL.listAll({ grupo, activos });
}

/** Un telar por código */
async function getByTelcod(telcod) {
  return telaresDAL.getByTelcod(telcod);
}

/** Mapa para workers (holdingOffset, coils, etc.) */
async function getMapView({ grupo = null } = {}) {
  return telaresDAL.getMapView({ grupo });
}

module.exports = { listAll, getByTelcod, getMapView };

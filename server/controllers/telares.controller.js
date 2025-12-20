// server/controllers/telares.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const telarSvc = require('../services/telar.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

module.exports.list = async (req, res, next) => {
  try {
    const { grupo, activos, view } = req.query;

    if (view === 'map') {
      const data = await telarSvc.getMapView({ grupo });
      return send(res, data);
    }

    const onlyActive = activos === undefined ? true : (String(activos).toLowerCase() === 'true');
    const data = await telarSvc.listAll({ grupo, activos: onlyActive });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.getOne = async (req, res, next) => {
  try {
    const { telcod } = req.params;
    if (!telcod) throw new HttpError(400, 'telcod requerido');
    const data = await telarSvc.getByTelcod(telcod);
    if (!data) throw new HttpError(404, 'Telar no encontrado');
    send(res, data);
  } catch (err) {
    next(err);
  }
};

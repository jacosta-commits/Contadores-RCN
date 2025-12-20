// server/controllers/sesion-telar.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const stSvc = require('../services/sesion-telar.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

// POST /api/v1/sesiones/:sescod/telares/:telcod  (también acepta body)
module.exports.asignar = async (req, res, next) => {
  try {
    const sescod = Number(req.params.sescod ?? req.body?.sescod);
    const telcod = req.params.telcod ?? req.body?.telcod;
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    if (!telcod) throw new HttpError(400, 'telcod requerido');

    const data = await stSvc.asignar({ sescod, telcod });
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/sesiones/:sescod/telares/:telcod  (también acepta body)
module.exports.quitar = async (req, res, next) => {
  try {
    const sescod = Number(req.params.sescod ?? req.body?.sescod);
    const telcod = req.params.telcod ?? req.body?.telcod;
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    if (!telcod) throw new HttpError(400, 'telcod requerido');

    const data = await stSvc.quitar({ sescod, telcod });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/sesiones/:sescod/telares
module.exports.activosPorSesion = async (req, res, next) => {
  try {
    const sescod = Number(req.params.sescod || req.query.sescod);
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');

    const data = await stSvc.listActivos({ sescod });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

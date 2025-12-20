// server/controllers/turnos.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const turnoSvc = require('../services/turno.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

module.exports.getCatalogo = async (req, res, next) => {
  try {
    const data = await turnoSvc.getCatalogo();
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.getActual = async (req, res, next) => {
  try {
    const dt = req.query.dt ? new Date(req.query.dt) : new Date();
    if (Number.isNaN(dt.getTime())) throw new HttpError(400, 'dt inválido');
    const data = await turnoSvc.getActual(dt);
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.getRango = async (req, res, next) => {
  try {
    const base = req.query.base ? new Date(req.query.base) : new Date();
    if (Number.isNaN(base.getTime())) throw new HttpError(400, 'base inválido');
    const turno = req.query.turno;
    if (!turno) throw new HttpError(400, 'turno requerido');
    const data = await turnoSvc.getRango(base, turno);
    send(res, data);
  } catch (err) {
    next(err);
  }
};

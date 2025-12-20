// server/controllers/supervisor.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const supSvc = require('../services/supervisor.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

module.exports.kpis = async (req, res, next) => {
  try {
    const { grupo = null, turno, base } = req.query;
    const baseDate = base ? new Date(base) : new Date();
    if (base && Number.isNaN(baseDate.getTime())) throw new HttpError(400, 'base inválido');

    // turno opcional: si no se manda, service puede resolver actual
    const data = await supSvc.getKPIs({
      grupo,
      turno_cod: turno || null,
      base_date: baseDate,
    });

    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.resumenSesionTelar = async (req, res, next) => {
  try {
    const sescod = req.query.sescod ? Number(req.query.sescod) : null;
    const telcod = req.query.telcod || null;
    if (sescod !== null && !Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');

    const data = await supSvc.getResumenSesionTelar({ sescod, telcod });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

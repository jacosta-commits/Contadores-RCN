// server/controllers/checklist.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const chkSvc = require('../services/checklist.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

module.exports.upsert = async (req, res, next) => {
  try {
    const { sescod, telcod, tracod, ...items } = req.body || {};
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    if (!telcod) throw new HttpError(400, 'telcod requerido');

    const data = await chkSvc.upsert({ sescod, telcod, tracod, items });
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.get = async (req, res, next) => {
  try {
    const sescod = Number(req.query.sescod);
    const telcod = req.query.telcod;
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    if (!telcod) throw new HttpError(400, 'telcod requerido');

    const data = await chkSvc.get({ sescod, telcod });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

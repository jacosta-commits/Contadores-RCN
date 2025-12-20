// server/controllers/llamadas.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const callSvc = require('../services/llamada.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

module.exports.crear = async (req, res, next) => {
  try {
    let { sescod, telcod, categoria = null, mensaje = null } = req.body || {};
    sescod = Number(sescod);
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    if (!telcod) throw new HttpError(400, 'telcod requerido');

    const data = await callSvc.crear({ sescod, telcod, categoria, mensaje });
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.actualizarEstado = async (req, res, next) => {
  try {
    const id = Number(req.params.id || req.body?.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'id inválido');
    const { estado, supervisor = null, completada = null, ended_at = null } = req.body || {};
    if (!estado) throw new HttpError(400, 'estado requerido (A/E/C)');
    const data = await callSvc.actualizarEstado({ id, estado, supervisor, completada, ended_at });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.listar = async (req, res, next) => {
  try {
    const { estado, telcod } = req.query;
    const sescod = req.query.sescod ? Number(req.query.sescod) : null;
    if (sescod !== null && !Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    const data = await callSvc.listar({ estado, telcod, sescod });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

// server/controllers/lecturas.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const lecSvc = require('../services/lectura.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseCommon(body = {}) {
  const telcodRaw = body.telcod;
  if (!telcodRaw) throw new HttpError(400, 'telcod requerido');
  const telcod = String(telcodRaw);

  // sescod puede venir como string → convertir a Number o dejarlo null
  const sesRaw = body.sescod;
  let sescod = null;
  if (sesRaw !== undefined && sesRaw !== null && sesRaw !== '') {
    const n = Number(sesRaw);
    if (!Number.isInteger(n)) throw new HttpError(400, 'sescod inválido');
    sescod = n;
  }

  // ts opcional: ISO string → Date
  const ts = body.ts ? new Date(body.ts) : null;
  if (ts && Number.isNaN(+ts)) throw new HttpError(400, 'ts inválido');

  return {
    sescod,
    telcod,
    ts,
    hil_act:   intOrNull(body.hil_act),
    hil_turno: intOrNull(body.hil_turno),
    hil_start: intOrNull(body.hil_start),
    set_value: intOrNull(body.set_value),
    tracod: body.tracod ? String(body.tracod) : null,
  };
}

module.exports.postInicio = async (req, res, next) => {
  try {
    const p = parseCommon(req.body);
    if (!Number.isInteger(p.sescod)) throw new HttpError(400, 'sescod requerido para INICIO_TURNO');
    const data = await lecSvc.registrarInicio(p);
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.postFin = async (req, res, next) => {
  try {
    const p = parseCommon(req.body);
    if (!Number.isInteger(p.sescod)) throw new HttpError(400, 'sescod requerido para FIN_TURNO');
    const data = await lecSvc.registrarFin(p);
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.postPeriodic = async (req, res, next) => {
  try {
    const p = parseCommon(req.body);
    const data = await lecSvc.registrarPeriodic(p);
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.postManual = async (req, res, next) => {
  try {
    const p = parseCommon(req.body);
    const data = await lecSvc.registrarManual(p);
    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.getPorTelar = async (req, res, next) => {
  try {
    const { telcod } = req.params;
    if (!telcod) throw new HttpError(400, 'telcod requerido');

    const { from, to, limit } = req.query;
    const dFrom = from ? new Date(from) : null;
    const dTo = to ? new Date(to) : null;
    if (dFrom && Number.isNaN(+dFrom)) throw new HttpError(400, 'from inválido');
    if (dTo && Number.isNaN(+dTo)) throw new HttpError(400, 'to inválido');

    const limNum = Number(limit);
    const lim = Number.isFinite(limNum) && limNum > 0 ? Math.trunc(limNum) : 200;

    const data = await lecSvc.listPorTelar({ telcod, from: dFrom, to: dTo, limit: lim });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.getPorSesion = async (req, res, next) => {
  try {
    const sescodNum = Number(req.params.sescod || req.query.sescod);
    if (!Number.isInteger(sescodNum)) throw new HttpError(400, 'sescod inválido');
    const data = await lecSvc.listPorSesion({ sescod: sescodNum });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

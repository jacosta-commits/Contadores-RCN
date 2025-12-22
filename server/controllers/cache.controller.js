// server/controllers/cache.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const cacheSvc = require('../services/cache.service');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

module.exports.getRecovery = async (req, res, next) => {
  try {
    const data = await cacheSvc.getRecovery();
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.upsert = async (req, res, next) => {
  try {
    const {
      telcod,
      sescod,        // undefined allowed
      tracod,        // undefined allowed
      traraz,        // undefined allowed
      turno_cod,     // undefined allowed
      session_active,// undefined allowed
      hil_act = 0,
      hil_turno = 0,
      hil_start,  // ← No default, para detectar si viene o no
      set_value,  // ← No default, para preservar valor DB si viene undefined
      velocidad = 0,
    } = req.body || {};

    if (!telcod) throw new HttpError(400, 'telcod requerido');
    if (sescod !== undefined && sescod !== null && !Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');

    // El DAL ahora maneja la preservación de hil_start cuando viene undefined
    // NO convertir 0 a undefined aquí, porque registrarFin puede legítimamente enviar valores numéricos
    const data = await cacheSvc.upsert({
      telcod,
      sescod,
      tracod,
      traraz,
      turno_cod,
      session_active,
      hil_act,
      hil_turno,
      hil_start, // Pasar tal cual, el DAL decide qué hacer
      set_value,
      velocidad,
    });

    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

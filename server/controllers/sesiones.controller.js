'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const sesionSvc = require('../services/sesion.service');

// Helper de respuesta (FALTABA)
const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

// (opcional) autocompletar nombre desde RR.HH.
let rrhhDal = null;
try {
  rrhhDal = require('../dal/rrhh.dal');
} catch (e) {
  logger.warn('[sesiones.controller] rrhh.dal no disponible, no se autocompletará traraz');
}

module.exports.abrir = async (req, res, next) => {
  try {
    const { tracod, traraz, turno_cod, dev_uuid } = req.body || {};
    if (!tracod) throw new HttpError(400, 'tracod requerido');

    const ip_origen = req.ip;
    const user_agent = req.get('user-agent') || null;

    // Si no llega nombre desde el front, intenta traerlo de RR.HH.
    let nombre = traraz || null;
    if (!nombre && rrhhDal?.getTrabajadorByTracod) {
      try {
        const row = await rrhhDal.getTrabajadorByTracod(tracod);
        if (row?.traraz) nombre = row.traraz;
      } catch (e) {
        logger.warn('[sesiones.controller] No se pudo obtener traraz para %s: %s', tracod, e.message);
      }
    }

    const data = await sesionSvc.abrir({
      tracod,
      traraz: nombre,
      turno_cod,
      dev_uuid,
      ip_origen,
      user_agent,
    });

    send(res, data, 201);
  } catch (err) {
    next(err);
  }
};

module.exports.cerrar = async (req, res, next) => {
  try {
    const sescod = Number(req.params.sescod || req.body?.sescod);
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    const data = await sesionSvc.cerrar({ sescod });
    send(res, data);
  } catch (err) {
    next(err);
  }
};

module.exports.detalle = async (req, res, next) => {
  try {
    const sescod = Number(req.params.sescod || req.query.sescod);
    if (!Number.isInteger(sescod)) throw new HttpError(400, 'sescod inválido');
    const data = await sesionSvc.getById(sescod);
    if (!data) throw new HttpError(404, 'Sesión no encontrada');
    send(res, data);
  } catch (err) {
    next(err);
  }
};

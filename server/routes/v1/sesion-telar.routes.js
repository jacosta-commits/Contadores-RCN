'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/sesion-telar.controller');

// Atajos para mapear params → body cuando se usan rutas con :sescod/:telcod
const paramsToBody = (req, _res, next) => {
  if (req.params.sescod && !req.body.sescod) req.body.sescod = Number(req.params.sescod);
  if (req.params.telcod && !req.body.telcod) req.body.telcod = req.params.telcod;
  next();
};

// POST /api/v1/sesion-telar   (body: {sescod,telcod})
router.post('/sesion-telar', ctrl.asignar);

// DELETE /api/v1/sesion-telar (body: {sescod,telcod})
router.delete('/sesion-telar', ctrl.quitar);

// GET /api/v1/sesion-telar/activos?sescod=123
router.get('/sesion-telar/activos', ctrl.activosPorSesion);

// — Alternativas con params (azúcar sintáctico) —

// POST /api/v1/sesiones/:sescod/telares/:telcod
router.post('/sesiones/:sescod/telares/:telcod', paramsToBody, ctrl.asignar);

// DELETE /api/v1/sesiones/:sescod/telares/:telcod
router.delete('/sesiones/:sescod/telares/:telcod', paramsToBody, ctrl.quitar);

// GET /api/v1/sesiones/:sescod/telares
router.get('/sesiones/:sescod/telares', (req, res, next) => {
  req.query.sescod = req.params.sescod;
  return ctrl.activosPorSesion(req, res, next);
});

module.exports = router;

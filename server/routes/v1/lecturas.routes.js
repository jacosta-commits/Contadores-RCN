'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/lecturas.controller');

// POST /api/v1/lecturas/inicio
// body: { sescod, telcod, ts?, hil_act?, hil_turno?, hil_start?, set_value?, tracod? }
router.post('/lecturas/inicio',   ctrl.postInicio);

// POST /api/v1/lecturas/fin
router.post('/lecturas/fin',      ctrl.postFin);

// POST /api/v1/lecturas/periodic
router.post('/lecturas/periodic', ctrl.postPeriodic);

// POST /api/v1/lecturas/manual
router.post('/lecturas/manual',   ctrl.postManual);

// GET /api/v1/lecturas?sescod=...&telcod=...&from=ISO&to=ISO
router.get('/lecturas', (req, res, next) => {
  if (req.query.telcod) {
    // el controller lee de req.params.telcod → mapeamos
    req.params.telcod = req.query.telcod;
    return ctrl.getPorTelar(req, res, next);
  }
  if (req.query.sescod) {
    return ctrl.getPorSesion(req, res, next);
  }
  return res.status(400).json({ ok: false, error: 'Debe enviar telcod o sescod' });
});

// GET /api/v1/lecturas/telar/:telcod?from=ISO&to=ISO
router.get('/lecturas/telar/:telcod', ctrl.getPorTelar);
// GET /api/v1/lecturas/sesion/:sescod
router.get('/lecturas/sesion/:sescod', (req, res, next) => {
  req.query.sescod = req.params.sescod;
  return ctrl.getPorSesion(req, res, next);
});

module.exports = router;

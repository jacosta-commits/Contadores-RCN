'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/supervisor.controller');

// GET /api/v1/supervisor/kpis?grupo=...&turno=1..5&base=YYYY-MM-DD|ISO
router.get('/supervisor/kpis', ctrl.kpis);

// GET /api/v1/supervisor/resumen-sesion-telar?sescod=...&telcod=...
router.get('/supervisor/resumen-sesion-telar', ctrl.resumenSesionTelar);

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/turnos.controller');

// GET /api/v1/turnos
router.get('/turnos', ctrl.getCatalogo);

// GET /api/v1/turno/actual?dt=ISO
router.get('/turno/actual', ctrl.getActual);

// GET /api/v1/turno/rango?base=YYYY-MM-DD|ISO&turno=1..5
router.get('/turno/rango', ctrl.getRango);

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/sesiones.controller');

// POST /api/v1/sesiones
// body: { tracod, traraz?, turno_cod?, dev_uuid? }
router.post('/sesiones', ctrl.abrir);

// PATCH /api/v1/sesiones/:sescod/cerrar
router.patch('/sesiones/:sescod/cerrar', ctrl.cerrar);

// GET /api/v1/sesiones/:sescod
router.get('/sesiones/:sescod', ctrl.detalle);

module.exports = router;

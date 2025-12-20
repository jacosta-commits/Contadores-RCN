'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/llamadas.controller');

// POST /api/v1/llamadas
// body: { sescod, telcod, categoria?, mensaje? }
router.post('/llamadas', ctrl.crear);

// PATCH /api/v1/llamadas/:id
// body: { estado?, supervisor?, completada?, ended_at? }
router.patch('/llamadas/:id', ctrl.actualizarEstado);

// GET /api/v1/llamadas?estado=A|E|C&sescod=...&telcod=...&desde=ISO&hasta=ISO
router.get('/llamadas', ctrl.listar);

module.exports = router;

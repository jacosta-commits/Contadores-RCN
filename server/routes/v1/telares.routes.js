'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/telares.controller');

// GET /api/v1/telares?grupo=...&activos=true|false
router.get('/telares', ctrl.list);          // lista/mapa con filtros por query

// GET /api/v1/telares/:telcod
router.get('/telares/:telcod', ctrl.getOne);

module.exports = router;

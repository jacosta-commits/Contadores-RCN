'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/util.controller');

// POST /api/v1/util/reset/:telcod
router.post('/util/reset/:telcod', ctrl.resetCounter);

// GET /api/v1/util/participantes/:telcod
router.get('/util/participantes/:telcod', ctrl.getParticipantes);

module.exports = router;

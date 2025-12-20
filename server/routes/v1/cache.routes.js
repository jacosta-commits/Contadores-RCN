'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/cache.controller');
console.log('Loading cache.routes.js');
console.log('ctrl.upsert is:', typeof ctrl.upsert);

// GET /api/v1/cache/recovery
router.get('/cache/recovery', ctrl.getRecovery);

// PUT /api/v1/cache
router.put('/cache', ctrl.upsert);

module.exports = router;

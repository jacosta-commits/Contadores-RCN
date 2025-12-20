'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/health.controller');

// GET /api/v1/health
router.get('/health', ctrl.ping);

module.exports = router;

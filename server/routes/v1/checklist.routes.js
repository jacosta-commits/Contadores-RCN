'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/checklist.controller');

// PUT /api/v1/checklist   (upsert)
// body: { sescod, telcod, ...items }
router.put('/checklist', ctrl.upsert);

// POST /api/v1/checklist  (upsert también, si prefieres POST)
router.post('/checklist', ctrl.upsert);

// GET /api/v1/checklist?sescod=...&telcod=...
router.get('/checklist', ctrl.get);

module.exports = router;

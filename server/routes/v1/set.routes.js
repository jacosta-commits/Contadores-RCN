'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/set.controller');

// PUT /api/v1/set/:telcod
// Body: { "set_value": 5000 }
router.put('/set/:telcod', ctrl.updateSet);

module.exports = router;

// server/routes/v1/rrhh.routes.js
'use strict';
const { Router } = require('express');
const ctrl = require('../../controllers/rrhh.controller');

const r = Router();
// usar el nombre correcto:
r.get('/rrhh/trabajadores/:tracod', ctrl.getByTracod);
module.exports = r;

'use strict';

const express = require('express');
const router = express.Router();

// Monta cada sub-router v1/*
router.use(require('./health.routes'));
router.use(require('./turnos.routes'));
router.use(require('./telares.routes'));
router.use(require('./sesiones.routes'));
router.use(require('./sesion-telar.routes'));
router.use(require('./checklist.routes'));
router.use(require('./lecturas.routes'));
router.use(require('./llamadas.routes'));
router.use(require('./cache.routes'));
router.use(require('./set.routes'));
router.use(require('./supervisor.routes'));
router.use(require('./rrhh.routes'));
router.use(require('./debug.routes'));
router.use(require('./util.routes'));

module.exports = router;

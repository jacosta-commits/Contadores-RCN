'use strict';
const router = require('express').Router();
const { bus } = require('../../sockets');

/**
 * POST /api/v1/admin/broadcast-reload
 * Envía señal de force-reload a todos los clientes operator y supervisor
 */
router.post('/broadcast-reload', (req, res) => {
    try {
        bus.admin.broadcastReload();
        res.json({ ok: true, message: 'Reload broadcast enviado a todos los clientes' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;

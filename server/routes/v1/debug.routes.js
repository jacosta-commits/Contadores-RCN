'use strict';
const express = require('express');
const router = express.Router();
// 👇 usamos el "bus" que ya sabe emitir al namespace /telar correctamente
const { bus } = require('../../sockets');

// GET /api/v1/debug/push/0059?h=10&a=120&t=5&s=300&v=420
router.get('/debug/push/:telcod', (req, res) => {
  const telcod = req.params.telcod;

  const toInt = (x, d = 0) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.trunc(n) : d;
  };

  const payload = {
    telcod,
    hil_start: toInt(req.query.h, 0),
    hil_act:   toInt(req.query.a, 0),
    hil_turno: toInt(req.query.t, 0),
    set_value: toInt(req.query.s, 0),
    velocidad: toInt(req.query.v, 0),
    ts: new Date().toISOString(),
  };

  // 🔴 AQUÍ está la diferencia clave:
  // Emite al namespace /telar y a la sala telar:0059 (por dentro usa telar.ns.js)
  bus.telar.state(telcod, payload);

  res.json({ ok: true, sent: payload });
});

module.exports = router;

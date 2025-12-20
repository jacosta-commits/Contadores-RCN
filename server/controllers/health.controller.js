// server/controllers/health.controller.js
'use strict';

const { HttpError } = require('../lib/errors');
const logger = require('../lib/logger');
const env = require('../lib/env');

const send = (res, data) => res.json({ ok: true, data });

module.exports.ping = async (req, res, next) => {
  try {
    send(res, {
      status: 'ok',
      now: new Date().toISOString(),
      env: {
        node: process.version,
        mode: env.NODE_ENV || 'development',
        host: env.HOST,
        port: env.PORT,
      },
    });
  } catch (err) {
    next(err);
  }
};

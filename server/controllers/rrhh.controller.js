'use strict';

const { HttpError } = require('../lib/errors');
const rrhhDal = require('../dal/rrhh.dal');

const send = (res, data, code = 200) => res.status(code).json({ ok: true, data });

const normalize = (v) => String(v || '').replace(/\D/g, '').padStart(5, '0');

module.exports.getByTracod = async (req, res, next) => {
  try {
    const tracod = normalize(req.params.tracod);
    if (!tracod) throw new HttpError(400, 'tracod requerido');

    const row = await rrhhDal.getTrabajadorByTracod(tracod);
    if (!row) throw new HttpError(404, 'Trabajador no encontrado');

    send(res, row);
  } catch (err) {
    next(err);
  }
};

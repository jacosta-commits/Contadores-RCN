'use strict';

const { HttpError } = require('../lib/errors');
const setService = require('../services/set.service');

/**
 * PUT /api/v1/set/:telcod
 * Actualiza el set_value (meta de lote) para un telar
 */
module.exports.updateSet = async (req, res, next) => {
    try {
        const { telcod } = req.params;
        const { set_value } = req.body;

        if (!telcod) throw new HttpError(400, 'telcod requerido');
        if (set_value === undefined || set_value === null) {
            throw new HttpError(400, 'set_value requerido');
        }

        const result = await setService.updateSet({ telcod, set_value });
        res.status(200).json({ ok: true, data: result });
    } catch (err) {
        next(err);
    }
};

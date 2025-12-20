'use strict';

const { HttpError } = require('../lib/errors');
const utilService = require('../services/util.service');

/**
 * POST /api/v1/util/reset/:telcod
 */
module.exports.resetCounter = async (req, res, next) => {
    try {
        const { telcod } = req.params;
        if (!telcod) throw new HttpError(400, 'telcod requerido');

        const result = await utilService.resetCounter(telcod);
        res.status(200).json({ ok: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/v1/util/participantes/:telcod
 * (Placeholder si se necesita implementar historial de participantes)
 */
module.exports.getParticipantes = async (req, res, next) => {
    try {
        // Por ahora devolvemos array vacío o mock, ya que no se especificó lógica real
        res.status(200).json({ ok: true, data: [] });
    } catch (err) {
        next(err);
    }
};

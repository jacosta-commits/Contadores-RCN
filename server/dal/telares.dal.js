'use strict';

const { sql, query } = require('./db');

/** Lista de telares con filtros opcionales */
async function listAll({ grupo = null, activos = true } = {}) {
  let q = `
    SELECT t.telcod, t.telnom, t.grupo, t.modbus_ip, t.modbus_port, t.modbus_unit_id,
           t.modo, t.calc_pulse_offset, t.plc_base_offset, t.plc_hil_act_rel,
           t.plc_velocidad_rel, t.plc_hil_turno_rel, t.plc_set_rel, t.plc_hil_start_rel,
           t.plc_coil_reset, t.plc_coil_fin_turno, t.activo, t.created_at, t.hil_acum_offset,
           r.tarjeta_display
    FROM dbo.RCN_CONT_TELAR t
    LEFT JOIN dbo.VW_RCN_CONT_RECOVERY r ON t.telcod = r.telcod
    WHERE 1=1
  `;
  const params = [];
  if (grupo) {
    q += ` AND grupo = @grupo`;
    params.push(['grupo', sql.VarChar(40), grupo]);
  }
  if (activos !== undefined) {
    q += ` AND activo = @act`;
    params.push(['act', sql.Bit, activos ? 1 : 0]);
  }
  q += ` ORDER BY grupo, telcod`;

  const rs = await query(q, req => {
    params.forEach(([name, type, val]) => req.input(name, type, val));
  });
  return rs.recordset;
}

/** Un telar por telcod */
async function getByTelcod(telcod) {
  const rs = await query(`
    SELECT t.telcod, t.telnom, t.grupo, t.modbus_ip, t.modbus_port, t.modbus_unit_id,
           t.modo, t.calc_pulse_offset, t.plc_base_offset, t.plc_hil_act_rel,
           t.plc_velocidad_rel, t.plc_hil_turno_rel, t.plc_set_rel, t.plc_hil_start_rel,
           t.plc_coil_reset, t.plc_coil_fin_turno, t.activo, t.created_at, t.hil_acum_offset,
           r.tarjeta_display
    FROM dbo.RCN_CONT_TELAR t
    LEFT JOIN dbo.VW_RCN_CONT_RECOVERY r ON t.telcod = r.telcod
    WHERE t.telcod = @telcod
  `, req => {
    req.input('telcod', sql.VarChar(10), telcod);
  });
  return rs.recordset[0] || null;
}

/** Vista "front-friendly" para mapear holdingOffset y coils */
async function getMapView({ grupo = null } = {}) {
  let q = `
    SELECT v.telarKey, v.sqlTelar, v.telnom, v.grupo, v.modbusIP, v.modbusPort, v.modbusID,
           v.holdingOffset, v.[mode], v.coilReset, v.coilFinTurno, v.activo,
           t.hil_acum_offset,
           t.plc_hil_act_rel, t.plc_velocidad_rel, t.plc_hil_turno_rel, t.plc_set_rel, t.plc_hil_start_rel
    FROM dbo.VW_RCN_CONT_TELAR_MAP v
    LEFT JOIN dbo.RCN_CONT_TELAR t ON v.sqlTelar = t.telcod
    WHERE 1=1
  `;
  const params = [];
  if (grupo) {
    q += ` AND v.grupo = @grupo`;
    params.push(['grupo', sql.VarChar(40), grupo]);
  }
  q += ` ORDER BY v.grupo, v.telarKey`;

  const rs = await query(q, req => {
    params.forEach(([n, t, v]) => req.input(n, t, v));
  });
  return rs.recordset;
}

/** Actualizar offset de acumulado */
async function updateAcumOffset(telcod, offset) {
  await query(`
    UPDATE dbo.RCN_CONT_TELAR
    SET hil_acum_offset = @offset
    WHERE telcod = @telcod
  `, req => {
    req.input('telcod', sql.VarChar(10), telcod);
    req.input('offset', sql.Int, offset);
  });
  return { telcod, hil_acum_offset: offset };
}

module.exports = {
  listAll,
  getByTelcod,
  getMapView,
  updateAcumOffset,
};

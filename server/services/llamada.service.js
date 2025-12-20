'use strict';

const logger = require('../lib/logger').child({ mod: 'llamada.service' });
const callDAL = require('../dal/llamadas.dal');

const telegram = require('../lib/telegram');

/** Crear llamada/ticket (soporta múltiples categorías separadas por coma) */
async function crear({ sescod, telcod, categoria = null, mensaje = null }) {
  const cats = (categoria || '').split(',').map(x => x.trim()).filter(Boolean);
  if (cats.length === 0) cats.push(null); // Fallback para general

  const results = [];

  const LABELS = {
    'MC': 'Mecánico / Calidad',
    'M': 'Mecánico',
    'S': 'Supervisor / Auxiliar',
    'E': 'Electricista',
    'Q': 'Calidad',
    'G': 'Gancho Inferior',
    'EN': 'Encarretador'
  };

  /* // Mapeo de destinatarios
   // Mapeo de destinatarios (Copied from App_RCN_web_con_PLC)
   const CHAT_MAP = {
     'MC': ['7611303895', '7431104838', '7916899127', '7819533784'], // Mecánico / Calidad
     'M': ['7611303895', '7431104838'],                             // Mecánico
     'S': ['7968380850', '7611303895'],                             // Supervisor / Auxiliar
     'E': ['7611303895', '7874886232'],                             // Electricista
     'Q': ['7611303895', '7916899127', '7819533784'],               // Calidad
     'G': ['7611303895', '7431104838', '7869616224'],               // Gancho Inferior
     'EN': ['7611303895', '7869616224', '7431104838'],               // Encarretadora
     'DEFAULT': ['7968380850', '7611303895']
   };*/

  const CHAT_MAP = {
    'MC': ['1546558805'], // Mecánico / Calidad
    'M': ['1546558805'],                             // Mecánico
    'S': ['1546558805'],                             // Supervisor / Auxiliar
    'E': ['1546558805'],                             // Electricista
    'Q': ['1546558805'],               // Calidad
    'G': ['1546558805'],               // Gancho Inferior
    'EN': ['1546558805'],               // Encarretadora
    'DEFAULT': ['1546558805']
  };

  for (const cat of cats) {
    // 1. Crear registro individual en BD
    try {
      logger.info('[llamada.service.crear] Creating call:', { sescod, telcod, categoria: cat, mensaje });
      const record = await callDAL.crear({ sescod, telcod, categoria: cat, mensaje });
      results.push(record);
      logger.info('[llamada.service.crear] Call created successfully:', { id: record.id });
    } catch (dbError) {
      logger.error('[llamada.service.crear] Database error:', {
        sescod,
        telcod,
        categoria: cat,
        mensaje,
        error: dbError.message,
        stack: dbError.stack,
        code: dbError.code,
        number: dbError.number,
        state: dbError.state
      });
      // Re-throw to let controller handle it
      throw dbError;
    }

    // 2. Enviar alerta individual por Telegram
    const catLabel = LABELS[cat] || cat || 'General';
    const recipients = CHAT_MAP[cat] || CHAT_MAP['DEFAULT'];

    const msg = `🚨 <b>LLAMADA TELAR ${telcod}</b>\n\n` +
      `<b>Motivo:</b> ${catLabel}\n` +
      (mensaje ? `<b>Nota:</b> ${mensaje}\n` : '') +
      `<i>Sesión: ${sescod}</i>`;

    telegram.broadcast(msg, recipients).catch(err => logger.error('[llamada.service] telegram error:', err));
  }

  // Retornamos el primero para mantener compatibilidad con response simple, o el array
  return results.length === 1 ? results[0] : results;
}

/** Actualizar estado/atributos (A/E/C, supervisor, completada, ended_at) */
async function actualizarEstado({ id, estado = null, supervisor = null, completada = null, ended_at = null }) {
  const ended = ended_at ? new Date(ended_at) : null;
  return callDAL.actualizar({ id, estado, supervisor, completada, ended_at: ended });
}

/** Alias por si tu router usa /actualizar */
async function actualizar(args) {
  return actualizarEstado(args);
}

/** Listado con filtros opcionales */
async function listar({ estado = null, telcod = null, sescod = null, desde = null, hasta = null }) {
  const d = desde ? new Date(desde) : null;
  const h = hasta ? new Date(hasta) : null;
  return callDAL.listar({ estado, telcod, sescod, desde: d, hasta: h });
}

module.exports = { crear, actualizarEstado, actualizar, listar };

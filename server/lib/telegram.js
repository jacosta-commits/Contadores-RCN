'use strict';

const env = require('./env');
const logger = require('./logger');

/**
 * Envía un mensaje a los chats configurados en CHAT_ALLOW.
 * @param {string} text - Texto a enviar (puede tener emojis)
 */
const DEFAULT_TOKEN = '7668553388:AAEI5MKHVEJFZhUKCiu04xQScTX02C32sS0';

/**
 * Envía un mensaje a los chats configurados.
 * @param {string} text - Texto a enviar
 * @param {string[]} [targetChats] - Lista opcional de chat IDs. Si no se pasa, usa CHAT_ALLOW del env.
 */
async function broadcast(text, targetChats = null) {
    const token = env.TG_BOT_TOKEN || DEFAULT_TOKEN;
    const chats = targetChats || env.CHAT_ALLOW;

    if (!token) {
        logger.warn('[telegram] No token configured.');
        return;
    }
    if (!chats || chats.length === 0) {
        logger.warn('[telegram] No recipients configured.');
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    for (const chatId of chats) {
        try {
            const body = {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML'
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const err = await res.text();
                logger.error(`[telegram] Error sending to ${chatId}: ${res.status} ${err}`);
            }
        } catch (error) {
            logger.error(`[telegram] Network error sending to ${chatId}:`, error);
        }
    }
}

module.exports = { broadcast };

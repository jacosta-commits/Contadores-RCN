// web/supervisor/assets/js/ws.js
// Client WS (primario en namespace /telar)

let socket = null;
let _onState = () => { };

/* Normaliza payloads */
function normalizeOne(obj = {}) {
    const p = { ...obj };
    if (!p.telcod) p.telcod = String(p.tel || p.key || p.id || p.telarKey || '');

    // Alias comunes
    if (p.hilStart != null) p.hil_start = p.hilStart;
    if (p.hilTurno != null) p.hil_turno = p.hilTurno;
    if (p.hilAct != null) p.hil_act = p.hilAct;
    if (p.hil_total != null) p.set_value = p.hil_total;
    if (p.speed != null) p.velocidad = p.speed;

    return p;
}

function handleIncoming(payload) {
    if (!payload) return;
    // console.debug('[ws] incoming', payload);

    // Caso 1: diffs { "0060": {..}, "0061": {..} }
    if (!Array.isArray(payload) && typeof payload === 'object' && !payload.telcod) {
        for (const [k, v] of Object.entries(payload)) {
            const norm = normalizeOne({ telcod: k, ...(v || {}) });
            if (norm.telcod) _onState(norm);
        }
        return;
    }

    // Caso 2: objeto único
    const norm = normalizeOne(payload);
    if (norm.telcod) _onState(norm);
}

export function init({ onState = () => { } } = {}) {
    _onState = onState;

    try {
        // eslint-disable-next-line no-undef
        socket = io('/telar', {
            transports: ['websocket', 'polling'],
            reconnection: true,
            path: '/socket.io'
        });

        socket.on('connect', () => console.debug('[ws] connected /telar', socket.id));
        socket.on('state', handleIncoming);
        socket.on('broadcast', handleIncoming);
        socket.on('update', handleIncoming);

    } catch (e) {
        console.warn('[ws] init failed:', e);
    }

    return socket;
}

export function joinRooms(telcods = []) {
    const arr = Array.isArray(telcods) ? telcods : [telcods];
    try {
        socket?.emit?.('rooms:join', { telcods: arr });
    } catch { }
}

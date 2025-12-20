/**
 * Client WS (primario en namespace /telar)
 * Exposición:
 *   init({ onState }) -> socket
 *   joinRooms(telcods[])   -> une a rooms (intenta 'rooms:join' y 'join')
 *   leaveRooms(telcods[])  -> sale de rooms
 */
let socket = null;
let _onState = () => { };

/* Normaliza payloads: admite camelCase/underscore y diffs por telar */
function normalizeOne(obj = {}) {
  const p = { ...obj };

  // telar key
  if (!p.telcod) p.telcod = String(p.tel || p.key || p.id || p.telarKey || '');

  // alias de campos
  const alias = [
    ['hil_start', ['hilStart', 'hstart']],
    ['hil_turno', ['hilTurno', 'hturno']],
    ['hil_act', ['hilAct', 'hact', 'actual']],
    ['set_value', ['set', 'setValue', 'hil_total', 'total']],
    ['velocidad', ['vel', 'speed']],
    ['session_active', ['sessionActive']],
    ['turno_cod', ['turnoCod']],
    ['traraz', ['opTraraz', 'nombre']],
    ['tracod', ['opTracod', 'codigo']],
  ];
  for (const [dst, srcs] of alias) {
    if (p[dst] != null) continue;
    for (const s of srcs) {
      if (p[s] != null) { p[dst] = p[s]; break; }
    }
  }

  return p;
}

function handleIncoming(payload) {
  if (!payload) return;
  console.debug('[ws] incoming', payload);

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

  // 1) Socket primario en /telar
  try {
    // eslint-disable-next-line no-undef
    socket = io('/telar', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1200,
      reconnectionAttempts: Infinity,
      path: '/socket.io'
    });

    socket.on('connect', () => console.debug('[ws] connected /telar', socket.id));
    socket.on('disconnect', (r) => console.debug('[ws] disconnected /telar', r));
    socket.on('error', (e) => console.warn('[ws] error /telar', e));

    // Eventos esperados desde el servidor:
    socket.on('state', handleIncoming);     // unitario
    socket.on('broadcast', handleIncoming); // compat
    socket.on('update', handleIncoming);    // diffs (compat con server raíz)
    socket.on('snapshot', handleIncoming);  // opcional al conectar
  } catch (e) {
    console.warn('[ws] init failed /telar:', e);
  }

  return socket;
}

export function joinRooms(telcods = []) {
  const arr = Array.isArray(telcods) ? telcods : [telcods];
  try {
    socket?.emit?.('rooms:join', { telcods: arr });
    socket?.emit?.('join', arr);           // compat
  } catch { }
}

export function leaveRooms(telcods = []) {
  const arr = Array.isArray(telcods) ? telcods : [telcods];
  console.debug('[ws] joinRooms', arr);
  try {
    socket?.emit?.('rooms:leave', { telcods: arr });
    socket?.emit?.('leave', arr);           // compat
  } catch { }
}

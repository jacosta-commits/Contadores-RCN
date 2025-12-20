// web/shared/js/ws.js
// Helper para namespaces de Socket.IO con join/leave de rooms.

let sockets = new Map(); // namespace -> socket

export function createWS(namespace = '/', { onConnect, onDisconnect, onError, handlers = {} } = {}) {
  const ioSock = io(namespace, {
    transports:['websocket'],
    reconnection:true,
    reconnectionDelay:1200,
    reconnectionAttempts:Infinity,
  });

  sockets.set(namespace, ioSock);

  ioSock.on('connect', () => onConnect?.(ioSock));
  ioSock.on('disconnect', reason => onDisconnect?.(reason));
  ioSock.on('error', e => onError?.(e));

  // registrar handlers personalizados { event: fn }
  Object.entries(handlers).forEach(([evt, fn]) => ioSock.on(evt, fn));
  // compat: algunos workers emiten 'broadcast'
  if (!handlers.broadcast) ioSock.on('broadcast', (p)=>handlers?.state?.(p));

  return ioSock;
}

export function joinRooms(namespace = '/', telcods = []) {
  const s = sockets.get(namespace); if (!s) return;
  if (!Array.isArray(telcods)) telcods = [telcods];
  s.emit('rooms:join', { telcods });
  s.emit('join', telcods); // compat
}
export function leaveRooms(namespace='/', telcods = []) {
  const s = sockets.get(namespace); if (!s) return;
  if (!Array.isArray(telcods)) telcods = [telcods];
  s.emit('rooms:leave', { telcods });
  s.emit('leave', telcods); // compat
}

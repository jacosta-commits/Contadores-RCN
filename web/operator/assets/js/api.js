// Simple wrapper de fetch para /api/v1/*
const API = '/api/v1';

async function fx(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    let err;
    try { const j = await r.json(); err = j?.error || j?.message || r.statusText; }
    catch { err = r.statusText; }
    throw new Error(err);
  }
  const data = await r.json().catch(() => ({}));
  return data?.data ?? data;
}

export const api = {
  // Sistema
  health: () => fx(`${API}/health`),

  // RRHH: buscar trabajador por código (VIEW_FISA_RRHH_TRABAJADOR)
  rrhh: {
    trabajador: (tracod) =>
      fx(`${API}/rrhh/trabajadores/${encodeURIComponent(tracod)}`),
  },

  // Turnos
  turnos: {
    catalogo: () => fx(`${API}/turnos`),
    actual: () => fx(`${API}/turno/actual`),
    rango: ({ base, turno }) => {
      const q = new URLSearchParams();
      if (base) q.set('base', base);
      if (turno) q.set('turno', turno);
      return fx(`${API}/turno/rango?${q.toString()}`);
    },
  },

  // Sesiones
  sesiones: {
    abrir: ({ tracod, traraz = null, turno_cod, dev_uuid = null }) =>
      fx(`${API}/sesiones`, { method: 'POST', body: { tracod, traraz, turno_cod, dev_uuid } }),
    cerrar: (sescod) =>
      fx(`${API}/sesiones/${sescod}/cerrar`, { method: 'PATCH' }),
    detalle: (sescod) => fx(`${API}/sesiones/${sescod}`),
  },

  // Telares
  telares: {
    list: ({ grupo = null, activos = true } = {}) => {
      const q = new URLSearchParams();
      if (grupo) q.set('grupo', grupo);
      if (activos !== undefined) q.set('activos', String(activos));
      return fx(`${API}/telares?${q.toString()}`);
    },
    get: (telcod) => fx(`${API}/telares/${encodeURIComponent(telcod)}`),
  },

  // Sesión-Telar (azúcar /sesiones/:sescod/telares/:telcod)
  sesionTelar: {
    asignar: ({ sescod, telcod }) =>
      fx(`${API}/sesiones/${sescod}/telares/${encodeURIComponent(telcod)}`, { method: 'POST' }),
    quitar: ({ sescod, telcod }) =>
      fx(`${API}/sesiones/${sescod}/telares/${encodeURIComponent(telcod)}`, { method: 'DELETE' }),
    activos: (sescod) => fx(`${API}/sesiones/${sescod}/telares`),
    listActivos: (sescod) => fx(`${API}/sesiones/${sescod}/telares`),
  },

  // Lecturas & Cache
  lecturas: {
    inicio: (payload) => fx(`${API}/lecturas/inicio`, { method: 'POST', body: payload }),
    fin: (payload) => fx(`${API}/lecturas/fin`, { method: 'POST', body: payload }),
    periodic: (payload) => fx(`${API}/lecturas/periodic`, { method: 'POST', body: payload }),
    porTelar: ({ telcod, from = null, to = null, limit = 200 }) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return fx(`${API}/lecturas/telar/${encodeURIComponent(telcod)}?${q.toString()}`);
    },
  },
  cache: {
    recovery: () => fx(`${API}/cache/recovery`),
    upsert: (p) => fx(`${API}/cache`, { method: 'PUT', body: p }),
  },

  // Llamadas
  llamadas: {
    crear: ({ sescod, telcod, categoria = null, mensaje = null }) =>
      fx(`${API}/llamadas`, { method: 'POST', body: { sescod, telcod, categoria, mensaje } }),
    listar: (params = {}) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params))
        if (v !== null && v !== undefined) q.set(k, v);
      return fx(`${API}/llamadas?${q.toString()}`);
    },
    actualizar: (id, payload) =>
      fx(`${API}/llamadas/${id}`, { method: 'PATCH', body: payload }),
  },

  // Checklist
  checklist: {
    get: ({ sescod, telcod }) =>
      fx(`${API}/checklist?sescod=${sescod}&telcod=${encodeURIComponent(telcod)}`),
    // Acepta tanto {answers:{...}} como claves planas ya mapeadas
    upsert: ({ sescod, telcod, tracod = null, answers = {}, ...flat }) =>
      fx(`${API}/checklist`, { method: 'PUT', body: { sescod, telcod, tracod, ...answers, ...flat } }),
  },
};

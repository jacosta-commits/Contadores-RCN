// web/shared/js/api.js
const API_BASE = '/api/v1';

async function fx(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j?.error || j?.message || msg; } catch {}
    throw new Error(msg);
  }
  try { const j = await r.json(); return j?.data ?? j; }
  catch { return null; }
}

export const api = {
  health: () => fx(`${API_BASE}/health`),

  turnos: {
    catalogo: () => fx(`${API_BASE}/turnos/catalogo`),
    actual:   () => fx(`${API_BASE}/turnos/actual`),
  },

  telares: {
    list: ({ grupo = null, activos = true } = {}) => {
      const q = new URLSearchParams();
      if (grupo) q.set('grupo', grupo);
      if (activos !== undefined) q.set('activos', String(activos));
      return fx(`${API_BASE}/telares?${q.toString()}`);
    },
    get: (telcod) => fx(`${API_BASE}/telares/${encodeURIComponent(telcod)}`),
  },

  sesiones: {
    abrir:  (p) => fx(`${API_BASE}/sesiones`, { method:'POST', body:p }),
    cerrar: (sescod) => fx(`${API_BASE}/sesiones/${sescod}`, { method:'PATCH', body:{ fin:new Date().toISOString() } }),
    detalle:(sescod) => fx(`${API_BASE}/sesiones/${sescod}`),
  },

  sesionTelar: {
    asignar: (p) => fx(`${API_BASE}/sesion-telar`, { method:'POST', body:p }),
    quitar:  ({sescod, telcod}) => fx(`${API_BASE}/sesion-telar/${sescod}/${encodeURIComponent(telcod)}`, { method:'DELETE' }),
    activos: (sescod) => fx(`${API_BASE}/sesion-telar/${sescod}`),
  },

  lecturas: {
    porTelar: ({ telcod, from = null, to = null, limit = 200 }) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return fx(`${API_BASE}/lecturas/telar/${encodeURIComponent(telcod)}?${q.toString()}`);
    },
    periodic: (payload) => fx(`${API_BASE}/lecturas/periodic`, { method:'POST', body:payload }),
  },

  llamadas: {
    crear:     (p) => fx(`${API_BASE}/llamadas`, { method:'POST', body:p }),
    listar:    (params = {}) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k,v]) => { if (v !== null && v !== undefined) q.set(k,v); });
      return fx(`${API_BASE}/llamadas?${q.toString()}`);
    },
    actualizar:(id, payload) => fx(`${API_BASE}/llamadas/${id}`, { method:'PATCH', body:payload }),
  },

  checklist: {
    get:    ({sescod, telcod}) => fx(`${API_BASE}/checklist?sescod=${sescod}&telcod=${encodeURIComponent(telcod)}`),
    upsert: (p) => fx(`${API_BASE}/checklist`, { method:'PUT', body:p }),
  },

  cache: {
    recovery: () => fx(`${API_BASE}/cache/recovery`),
    upsert:   (p) => fx(`${API_BASE}/cache`, { method:'PUT', body:p }),
  },

  supervisor: {
    kpis: (params={})=>{
      const q = new URLSearchParams(params);
      return fx(`${API_BASE}/supervisor/kpis?${q.toString()}`);
    },
    resumenSesionTelar: (params={})=>{
      const q = new URLSearchParams(params);
      return fx(`${API_BASE}/supervisor/resumen-sesion-telar?${q.toString()}`);
    }
  }
};

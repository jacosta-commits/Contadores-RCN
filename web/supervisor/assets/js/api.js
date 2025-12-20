// web/supervisor/assets/js/api.js
// Wrapper de fetch para /api/v1/* (Reutilizado de Operator)

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
    // Telares
    telares: {
        list: ({ grupo = null, activos = true } = {}) => {
            const q = new URLSearchParams();
            if (grupo) q.set('grupo', grupo);
            if (activos !== undefined) q.set('activos', String(activos));
            return fx(`${API}/telares?${q.toString()}`);
        },
        get: (telcod) => fx(`${API}/telares/${encodeURIComponent(telcod)}`),
        // Endpoint para resetear contador (si existe en backend)
        reset: (telcod) => fx(`${API}/util/reset/${encodeURIComponent(telcod)}`, { method: 'POST' }),
        // Endpoint para setear hilo total
        setTotal: (telcod, hilTotal) =>
            fx(`${API}/set/${encodeURIComponent(telcod)}`, { method: 'PUT', body: { set_value: hilTotal } }),
    },

    // Llamadas (Tickets)
    llamadas: {
        listar: (params = {}) => {
            const q = new URLSearchParams();
            for (const [k, v] of Object.entries(params))
                if (v !== null && v !== undefined) q.set(k, v);
            return fx(`${API}/llamadas?${q.toString()}`);
        },
        actualizar: (id, payload) =>
            fx(`${API}/llamadas/${id}`, { method: 'PATCH', body: payload }),
    },

    // Utilidades (Historial participantes)
    util: {
        participantes: (telcod) => fx(`${API}/util/participantes/${encodeURIComponent(telcod)}`),
    }
};

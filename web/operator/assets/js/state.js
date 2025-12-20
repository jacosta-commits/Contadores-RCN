/** Estado global muy simple con pub/sub y persistencia localStorage */
const LS_SESSION = 'op.session';
const LS_TELARES = 'op.telares';

class Emitter {
  constructor() { this.map = new Map(); }
  on(evt, cb) { if (!this.map.has(evt)) this.map.set(evt, new Set()); this.map.get(evt).add(cb); return () => this.off(evt, cb); }
  off(evt, cb) { this.map.get(evt)?.delete(cb); }
  emit(evt, payload) { this.map.get(evt)?.forEach(cb => cb(payload)); }
}

export const store = {
  events: new Emitter(),
  session: null,           // {sescod,tracod,traraz,turno_cod,inicio_dt}
  telares: [],             // [{telcod,label}]  ← PERSISTEN SIEMPRE
  counters: {},            // telcod -> {hil_start,hil_turno,hil_act,set_value,velocidad}
  pendCount: 0,

  load() {
    try { this.session = JSON.parse(localStorage.getItem(LS_SESSION)) || null; } catch { }
    try { this.telares = JSON.parse(localStorage.getItem(LS_TELARES)) || []; } catch { }
  },
  save() {
    localStorage.setItem(LS_SESSION, JSON.stringify(this.session));
    localStorage.setItem(LS_TELARES, JSON.stringify(this.telares));
  },

  // ---- sesión (NO afecta telares) ----
  setSession(sess) {
    this.session = sess;
    this.save();
    this.events.emit('session:change', this.session);
  },

  // ---- telares fijados (máx 2) ----
  setTelares(arr) {
    const next = Array.isArray(arr) ? arr.slice(0, 2) : [];
    // normaliza a {telcod, telnom, label}
    this.telares = next.map(v => {
      if (typeof v === 'string') return { telcod: v, telnom: null, label: v };
      return { ...v, telnom: v.telnom || v.label || null };
    });
    this.save();
    this.events.emit('telares:change', this.telares);
  },

  // ---- estado en vivo por telar ----
  setCounter(telcod, data) {
    this.counters[telcod] = { ...(this.counters[telcod] || {}), ...data };
    this.events.emit('counter:update', { telcod, data: this.counters[telcod] });
  },

  setPendCount(n) {
    this.pendCount = n;
    this.events.emit('pend:update', n);
  },
};
store.load();

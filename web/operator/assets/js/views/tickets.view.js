// web/operator/assets/js/views/tickets.view.js
// Adapted from Contadores_02/public/operario/js/tickets.js

import { api } from '../api.js';
import { store } from '../state.js';

const formatDuration = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (hh) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// Map category key to UI type
function catKeyToTipo(catKey) {
    const map = {
        'EN': 'encarretadora',
        'M': 'mecanico',
        'MC': 'mecanico',
        'S': 'supervisor',
        'E': 'electricista',
        'Q': 'calidad',
        'G': 'gancho'
    };
    return map[catKey] || 'general';
}

// Store
export const TicketsStore = {
    list: [],
    ticker: null,
    currentFilter: 'all',
    autoCloseTimer: null,

    async init() {
        await this.syncFromServer();
        this.updateBadge();
    },

    async syncFromServer() {
        if (!store.session?.sescod) return;
        try {
            const data = await api.llamadas.listar({ estado: 'A', sescod: store.session.sescod });
            this.list = (data || []).map(row => ({
                id: row.id,
                dbId: row.id, // Server ID
                tipo: catKeyToTipo(row.categoria),
                categoria: row.categoria, // Key like 'MC', 'M', etc.
                telcod: row.telcod,
                estado: 'activo',
                inicio: new Date(row.started_at).getTime(),
                mensaje: row.mensaje
            }));
            this.updateBadge();
        } catch (e) {
            console.error('[tickets] sync error:', e);
        }
    },

    async finalize(id, action /* 'attend' | 'cancel' */) {
        // Use loose equality to match string/number IDs
        const t = this.list.find(x => x.id == id);

        if (!t) return;

        // Disable buttons
        const row = document.querySelector(`.tk-row[data-id="${id}"]`);
        if (row) {
            row.querySelectorAll('.tk-btn').forEach(b => b.disabled = true);
        }

        const estadoMap = { 'attend': 'C', 'cancel': 'C' }; // Both close with estado='C'
        // completada: 1 (True) for Atendido, 0 (False) for Anular
        const completadaMap = { 'attend': 1, 'cancel': 0 };
        const labelMap = { 'attend': 'Atendido', 'cancel': 'Anulado' };

        try {
            const payload = {
                estado: estadoMap[action],
                completada: completadaMap[action],
                ended_at: new Date().toISOString()
            };

            await api.llamadas.actualizar(t.dbId, payload);

            // Refresh list
            await this.syncFromServer();
            TicketsUI.render();

            const dur = formatDuration(Date.now() - t.inicio);
            showToast(`Llamada ${labelMap[action].toLowerCase()} (${dur})`);

            // Emit event for badge update
            store.events.emit('tickets:change');

        } catch (e) {
            console.error('[tickets] finalize error:', e);
            alert('No se pudo cerrar la llamada.\n' + (e.message || JSON.stringify(e)));
            if (row) row.querySelectorAll('.tk-btn').forEach(b => b.disabled = false);
        }
    },

    abiertosCount() {
        return this.list.length;
    },

    updateBadge() {
        const n = this.abiertosCount();
        const badge = document.getElementById('ticketsBadge');
        if (badge) badge.textContent = String(n);
    }
};

// UI
export const TicketsUI = {
    async open() {
        const overlay = document.getElementById('ticketsOverlay');
        const drawer = document.getElementById('ticketsDrawer');
        if (!overlay || !drawer) return;

        overlay.classList.remove('hidden');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');

        await TicketsStore.syncFromServer();
        this.render();
        this.startTicker();
    },

    close() {
        const overlay = document.getElementById('ticketsOverlay');
        const drawer = document.getElementById('ticketsDrawer');
        if (!overlay || !drawer) return;

        overlay.classList.add('hidden');
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        this.stopTicker();
        if (TicketsStore.autoCloseTimer) {
            clearTimeout(TicketsStore.autoCloseTimer);
            TicketsStore.autoCloseTimer = null;
        }
    },

    render() {
        const listEl = document.getElementById('ticketsList');
        if (!listEl) return;

        const data = TicketsStore.list.filter(t => {
            if (TicketsStore.currentFilter === 'all') return true;
            return t.tipo === TicketsStore.currentFilter;
        });

        document.getElementById('ticketsCount').textContent = `(${data.length})`;

        if (!data.length) {
            listEl.innerHTML = '<div class="tk-empty">Sin tickets abiertos.</div>';
            return;
        }

        listEl.innerHTML = data.map(rowHTML).join('');

        // Wire buttons
        const attendBtns = listEl.querySelectorAll('.tk-btn.attend');
        const cancelBtns = listEl.querySelectorAll('.tk-btn.cancel');

        attendBtns.forEach(btn => {
            btn.addEventListener('click', e => {
                const id = Number(e.currentTarget.getAttribute('data-id'));
                TicketsStore.finalize(id, 'attend');
            });
        });
        cancelBtns.forEach(btn => {
            btn.addEventListener('click', e => {
                const id = Number(e.currentTarget.getAttribute('data-id'));
                if (confirm('¿Anular este ticket?')) {
                    TicketsStore.finalize(id, 'cancel');
                }
            });
        });

        this.updateDurations();
    },

    startTicker() {
        if (TicketsStore.ticker) return;
        TicketsStore.ticker = setInterval(() => this.updateDurations(), 1000);
    },

    stopTicker() {
        if (TicketsStore.ticker) {
            clearInterval(TicketsStore.ticker);
            TicketsStore.ticker = null;
        }
    },

    updateDurations() {
        document.querySelectorAll('.tk-timer[data-start]').forEach(el => {
            const start = Number(el.getAttribute('data-start'));
            el.textContent = formatDuration(Date.now() - start);
        });
    },

    scheduleAutoClose(ms = 3000, toastMsg = 'Llamada registrada') {
        if (TicketsStore.autoCloseTimer) clearTimeout(TicketsStore.autoCloseTimer);
        TicketsStore.autoCloseTimer = setTimeout(() => {
            this.close();
            showToast(toastMsg);
        }, ms);
    }
};

function rowHTML(t) {
    const tipoName = {
        encarretadora: 'Encarretadora',
        mecanico: 'Mecánico',
        supervisor: 'Supervisor',
        electricista: 'Electricista',
        calidad: 'Calidad',
        gancho: 'Gancho'
    }[t.tipo] || 'General';

    const telarChip = `<span class="tk-chip">Telar ${t.telcod}</span>`;
    const estadoChip = `<span class="tk-chip">${capitalize(t.estado)}</span>`;

    return `
    <div class="tk-row" data-id="${t.id}">
      <div class="tk-main">
        <div class="tk-title">
          <span>${tipoName}</span>
          <div class="tk-badges">${telarChip} ${estadoChip}</div>
        </div>
        <div class="tk-sub">
          <span class="tk-timer" data-start="${t.inicio}">${formatDuration(Date.now() - t.inicio)}</span>
        </div>
      </div>
      <div class="tk-actions">
        <button class="tk-btn attend" data-id="${t.id}">Atendido</button>
        <button class="tk-btn cancel"  data-id="${t.id}">Anular</button>
      </div>
    </div>
  `;
}

function showToast(msg = 'Operación realizada') {
    let el = document.getElementById('toastSuccess');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toastSuccess';
        Object.assign(el.style, {
            position: 'fixed',
            left: '50%',
            bottom: 'calc(var(--footer-h, 80px) + 8px)',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(180deg,#00c389,#00a676)',
            color: '#061a2a',
            padding: '10px 14px',
            borderRadius: '12px',
            fontWeight: '800',
            boxShadow: '0 10px 24px rgba(0,0,0,.28)',
            zIndex: '7000',
            transition: 'opacity .2s ease',
            opacity: '0'
        });
        document.body.appendChild(el);
    }
    el.textContent = `✅ ${msg}`;
    el.style.opacity = '1';
    setTimeout(() => { el && (el.style.opacity = '0'); }, 1800);
    setTimeout(() => { el && el.remove(); }, 2300);
}

// Wire overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'ticketsOverlay' || e.target.id === 'ticketsClose') {
        TicketsUI.close();
    }
});

// Wire filter buttons
document.addEventListener('click', (e) => {
    const b = e.target.closest('.tkf');
    if (!b) return;
    document.querySelectorAll('.tickets-toolbar .tkf').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    TicketsStore.currentFilter = b.dataset.filter || 'all';
    TicketsUI.render();
});

// Export for global access
window.TicketsStore = TicketsStore;
window.TicketsUI = TicketsUI;

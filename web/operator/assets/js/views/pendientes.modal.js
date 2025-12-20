// pendientes.modal.js
// Panel lateral (Drawer) con listado de llamadas abiertas (A)
// Permite filtrar y cerrar tickets manualmente.

import { api } from '../api.js';
import { store } from '../state.js';

const CAT_LABELS = {
  'MC': 'Mecánico / Calidad',
  'M': 'Mecánico',
  'S': 'Supervisor / Auxiliar',
  'E': 'Electricista',
  'Q': 'Calidad',
  'G': 'Gancho Inferior',
  'EN': 'Encarretador'
};

export function openPendientesModal({ sescod }) {
  return new Promise(async (resolve) => {
    // 1. Estructura del Drawer + Backdrop
    const host = document.createElement('div');
    host.className = 'drawer-host';
    host.style.cssText = `
      position: fixed; inset: 0; z-index: 9999; display: flex; justify-content: flex-end; font-family: 'Inter', sans-serif;
    `;

    host.innerHTML = `
      <div class="drawer-backdrop" style="position: absolute; inset: 0; background: rgba(0,0,0,0.6); opacity: 0; transition: opacity 0.3s;"></div>
      <div class="drawer-panel" style="
        position: relative; width: 420px; max-width: 90vw; height: 100%;
        background: #181a1b; box-shadow: -4px 0 30px rgba(0,0,0,0.8);
        display: flex; flex-direction: column; border-left: 1px solid rgba(255,255,255,0.1);
        transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      ">
        <header style="
          padding: 24px; border-bottom: 1px solid rgba(255,255,255,0.08); 
          display: flex; justify-content: space-between; align-items: center; background: #202324;
        ">
          <div>
            <h3 style="margin: 0; color: #e8e6e3; font-size: 1.1rem; font-weight: 600; letter-spacing: 0.5px;">TICKETS PENDIENTES</h3>
            <div style="font-size: 0.8rem; color: #999; margin-top: 4px;">Gestiona las alertas activas</div>
          </div>
          <button id="close-drawer" class="btn btn--ghost" style="padding: 8px; color: #aaa;">✕</button>
        </header>

        <div class="tabs" style="
          padding: 16px 24px; display: flex; gap: 8px; overflow-x: auto; 
          border-bottom: 1px solid rgba(255,255,255,0.05); background: #181a1b;
        ">
          <button data-k="ALL" class="tab-chip is-selected">Todos</button>
          <button data-k="EN" class="tab-chip">Encarret.</button>
          <button data-k="M" class="tab-chip">Mecánico</button>
          <button data-k="S" class="tab-chip">Superv.</button>
        </div>

        <div id="drawer-body" style="flex: 1; overflow-y: auto; padding: 24px; background: #141617;">
          <div style="text-align: center; color: rgba(255,255,255,0.3); margin-top: 60px;">
            <div class="spinner"></div>
            <p style="font-size: 0.9rem;">Cargando tickets...</p>
          </div>
        </div>

        <footer style="
          padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.08); 
          text-align: center; color: rgba(255,255,255,0.2); font-size: 0.75rem; background: #202324;
        ">
          RCN Contadores • Panel de Operador
        </footer>
      </div>
      <style>
        .tab-chip {
          background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #aaa;
          padding: 6px 14px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;
        }
        .tab-chip:hover { background: rgba(255,255,255,0.05); color: #fff; border-color: rgba(255,255,255,0.3); }
        .tab-chip.is-selected { background: #e8e6e3; color: #111; border-color: #e8e6e3; font-weight: 600; }
        
        .ticket-card {
          background: #25282a; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
          padding: 16px; margin-bottom: 16px; transition: transform 0.2s;
          position: relative; overflow: hidden;
        }
        .ticket-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        
        .ticket-actions { display: flex; gap: 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05); }
        .btn-action { flex: 1; padding: 8px; border-radius: 4px; font-size: 0.85rem; cursor: pointer; border: none; font-weight: 500; transition: opacity 0.2s; }
        .btn-action:hover { opacity: 0.9; }
        
        .btn-resolve { background: #2e7d32; color: #fff; } /* Green */
        .btn-cancel { background: #c62828; color: #fff; } /* Red */
      </style>
    `;
    document.body.appendChild(host);

    // Referencias
    const backdrop = host.querySelector('.drawer-backdrop');
    const panel = host.querySelector('.drawer-panel');
    const body = host.querySelector('#drawer-body');
    let allData = [];

    // Animación de entrada
    requestAnimationFrame(() => {
      backdrop.style.opacity = '1';
      panel.style.transform = 'translateX(0)';
    });

    // Cierre
    const onClose = () => {
      backdrop.style.opacity = '0';
      panel.style.transform = 'translateX(100%)';
      setTimeout(() => { host.remove(); resolve(); }, 300);
    };

    host.querySelector('#close-drawer').addEventListener('click', onClose);
    backdrop.addEventListener('click', onClose);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose(); }, { once: true });

    // Cargar datos
    try {
      const r = await api.llamadas.listar({ estado: 'A', sescod });
      allData = Array.isArray(r) ? r : (r?.data || []);
      renderList('ALL');
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div style="color: #ff6b6b; text-align: center; margin-top: 40px;">Error cargando tickets</div>`;
    }

    // Tabs
    host.querySelector('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      host.querySelectorAll('.tabs button').forEach(x => x.classList.remove('is-selected'));
      b.classList.add('is-selected');
      renderList(b.dataset.k);
    });

    // Renderizado
    function renderList(filter) {
      const filtered = allData.filter(x => filter === 'ALL' ? true : (x.categoria === filter));

      if (filtered.length === 0) {
        body.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: rgba(255,255,255,0.2);">
            <div style="font-size: 3rem; margin-bottom: 10px;">✓</div>
            <div>No hay tickets pendientes</div>
          </div>`;
        return;
      }

      body.innerHTML = filtered.map(x => {
        const catName = CAT_LABELS[x.categoria] || x.categoria || 'General';
        const time = new Date(x.started_at || x.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
        <div class="ticket-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <span style="color: #4fc3f7; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">TELAR ${x.telcod}</span>
              <div style="color: #fff; font-size: 1.1rem; font-weight: 600; margin-top: 4px;">${catName}</div>
            </div>
            <span style="font-family: monospace; color: #777; font-size: 0.9rem;">${time}</span>
          </div>
          
          ${x.mensaje ? `<div style="font-size: 0.9rem; color: #bbb; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-top: 8px;">"${x.mensaje}"</div>` : ''}
          
          <div class="ticket-actions">
            <button class="btn-action btn-cancel" data-id="${x.id}" title="Fue un error">Anular</button>
            <button class="btn-action btn-resolve" data-id="${x.id}" title="Ya fue atendido">Atendido</button>
          </div>
        </div>
      `}).join('');

      // Bind actions
      body.querySelectorAll('.btn-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.dataset.id;
          const isResolve = e.target.classList.contains('btn-resolve');
          const action = isResolve ? 'ATENDIDO' : 'ANULADO';

          if (!confirm(`¿Marcar ticket como ${action}?`)) return;

          try {
            // Optimistic UI
            const card = e.target.closest('.ticket-card');
            card.style.opacity = '0.5';
            card.style.pointerEvents = 'none';

            // completada=1 (Atendido), completada=0 (Anulado/Cancelado)
            await api.llamadas.actualizar(id, {
              estado: 'C',
              completada: isResolve ? 1 : 0,
              ended_at: new Date()
            });

            // Remove and re-render
            allData = allData.filter(d => String(d.id) !== String(id));
            renderList(host.querySelector('.tabs .is-selected').dataset.k);

            // Emit event to update badge
            store.events.emit('tickets:change');

          } catch (err) {
            console.error(err);
            alert('Error al actualizar ticket');
            const card = e.target.closest('.ticket-card');
            if (card) {
              card.style.opacity = '1';
              card.style.pointerEvents = 'all';
            }
          }
        });
      });
    }
  });
}

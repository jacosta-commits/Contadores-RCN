// web/operator/assets/js/app.js
import { api } from './api.js';
import { init as wsInit, joinRooms, leaveRooms } from './ws.js';
import { store } from './state.js';
import { Layout } from './layout.js';

import {
  render as renderHome,
  patchByTelar,
  refreshTitles,
  openCall,
  openPendientes
} from './views/home.view.js';
import { runLoginFlow } from './views/login.view.js';
import { openSelectTelaresModal } from './views/select-telares.modal.js';
import { openChecklistView } from './views/checklist.view.js';
import { TicketsStore, TicketsUI } from './views/tickets.view.js';

const APP_VERSION = 'op-app vB-2025-10-31g';
console.info(`[ui] ${APP_VERSION} cargado`);

// Telar robusto: acepta objeto {telcod} o string '0059'
const telOf = (t) => (typeof t === 'object' ? (t.telcod ?? t.tel) : t);

function $(sel) { return document.querySelector(sel); }
const hasSession = () => !!store.session?.sescod;

// Forzar checklist de LLENADO (al iniciar sesión)
function openChecklistFill() {
  if (!store.session?.sescod) return;
  const telas = Array.isArray(store.telares) ? store.telares : [];
  if (telas.length === 0) return;
  openChecklistView({ sescod: store.session.sescod, telares: telas, readonly: false });
}

// “Revisar checklist” (solo lectura)
function openChecklistReadonly() {
  if (!store.session?.sescod) return;
  const telas = Array.isArray(store.telares) ? store.telares : [];
  if (telas.length === 0) return;
  openChecklistView({ sescod: store.session.sescod, telares: telas, readonly: true });
}

async function startNewSession() {
  Layout.showDualLayout();
  await runLoginFlow();
  await asignarTelaresYSnapshotInicio();
  setTimeout(openChecklistFill, 150);
}

async function bootstrap() {
  Layout.injectCSS();
  Layout.startClock();

  renderHome($('#app'));
  await applyHeader();
  Layout.renderFooter(store.telares);

  wsInit({
    onState: (payload) => {
      console.debug('[ws] onState', payload);
      if (!payload?.telcod) return;
      store.setCounter(payload.telcod, payload);
      patchByTelar(payload.telcod, payload);
    },
    onSessionClosed: (payload) => {
      // Si la sesión cerrada por el servidor es la mía actual
      if (store.session?.sescod && String(payload?.sescod) === String(store.session.sescod)) {
        if (!window._isManualClose) {
          console.warn('⚠️ Sesión terminada remotamente (ej: expiración de tiempo). Cerrando UI...');
          alert('Tu turno ha sido cerrado automáticamente por límite de tiempo o por un administrador.');
        }
        window._isManualClose = false;
        store.setSession(null);
        applyHeader();
        renderHome($('#app'));
        Layout.showSingleLayout();
        setTimeout(() => startNewSession(), 500);
      }
    }
  });

  try {
    const rec = await api.cache.recovery();
    if (Array.isArray(rec)) {
      rec.forEach(r => {
        const tel = r.telcod || r.tel || r.codigo;
        store.setCounter(tel, {
          hil_start: r.hil_start ?? r.hil_inicio ?? r.hilInicio,
          hil_turno: r.hil_turno ?? r.hilTurno,
          hil_act: r.hil_act ?? r.hilActual,
          set_value: r.set_value ?? r.set ?? r.hil_total ?? 0,
          velocidad: r.velocidad ?? r.speed ?? 0,
        });
        patchByTelar(tel, store.counters[tel]);
      });
    }
  } catch { }

  if (store.telares.length > 0) {
    joinRooms(store.telares.map(telOf).filter(Boolean));
    refreshTitles();
  }

  store.events.on('telares:change', telas => {
    leaveRooms(['*']);
    if (telas.length > 0) joinRooms(telas.map(telOf).filter(Boolean));
    refreshTitles();
    renderHome($('#app'));
    Layout.renderFooter(telas); // Re-render footer
  });

  store.events.on('pend:update', n => {
    Layout.updateTicketsBadge(n);
  });

  // Al abrir sesión → abrir checklist de llenado
  store.events.on('session:change', async (sess) => {
    applyHeader();
    if (sess?.sescod) {
      try {
        await asignarTelaresYSnapshotInicio(); // asegura el POST /sesiones/:sescod/telares/:telcod
      } catch (e) {
        console.error('[asignarTelaresYSnapshotInicio] fallo en session:change', e);
      }
      setTimeout(() => {
        Layout.showDualLayout();
        openChecklistFill();
      }, 150);
    } else {
      Layout.showSingleLayout();
    }
  });

  wireLayoutActions();

  // Polling de pendientes y validación periódica de sesión (fallback)
  async function refreshPendingCount() {
    if (!store.session?.sescod) return;
    try {
      const list = await api.llamadas.listar({ estado: 'A', sescod: store.session.sescod });
      const n = Array.isArray(list) ? list.length : 0;
      store.events.emit('pend:update', n);

      // Verificación pasiva de sesión por si se cerró por BD/Job y el WS falló
      const sessData = await api.sesiones.detalle(store.session.sescod);
      if (!sessData || sessData.activo === 0 || sessData.activo === false) {
        console.warn('[app] Background check: Sesión cerrada en el servidor');
        store.setSession(null);
        applyHeader();
        renderHome($('#app'));
        Layout.showSingleLayout();
        setTimeout(() => startNewSession(), 500);
      }
    } catch { }
  }

  store.events.on('tickets:change', refreshPendingCount);
  setInterval(refreshPendingCount, 15_000); // Poll cada 15s

  if (!store.session) {
    await startNewSession();
  } else {
    // Validar sesión contra el servidor al arrancar
    try {
      const sessData = await api.sesiones.detalle(store.session.sescod);
      if (!sessData || sessData.activo === 0 || sessData.activo === false) {
        throw new Error('Sesión inactiva en servidor');
      }
      // Recuperar telares del servidor si localStorage los perdió (ej: reinicio de tablet)
      if (store.telares.length === 0) {
        try {
          const activos = await api.sesionTelar.listActivos(store.session.sescod);
          if (Array.isArray(activos) && activos.length > 0) {
            console.info('[app] Telares recuperados del servidor:', activos.map(t => t.telcod || t));
            store.setTelares(activos);
            renderHome($('#app'));
          }
        } catch (e) { console.warn('[app] No se pudieron recuperar telares del servidor:', e.message); }
      }

      Layout.showSingleLayout(); // Por defecto single si ya hay sesión
      refreshPendingCount();
    } catch (e) {
      console.warn('[app] Sesión local inválida o expirada:', e.message);
      store.setSession(null);
      await startNewSession();
    }
  }
}
bootstrap();

// ---------- Snapshots / asignaciones ----------
async function asignarTelaresYSnapshotInicio() {
  if (!store.session) return;
  const sescod = store.session.sescod;
  const telares = store.telares.map(telOf).filter(Boolean);
  if (telares.length === 0) return;

  // 1) Asignar telares (backend registra INICIO_TURNO automáticamente)
  const asignRes = await Promise.allSettled(
    telares.map(telcod => api.sesionTelar.asignar({ sescod, telcod }))
  );

  const errors = [];
  asignRes.forEach((r, i) => {
    const telcod = telares[i];
    if (r.status === 'fulfilled') {
      console.info('[sesionTelar.asignar] OK', r.value);
    } else {
      console.error('[sesionTelar.asignar] ERROR', { sescod, telcod }, r.reason);
      const msg = r.reason?.message || 'Error desconocido';
      errors.push(`- ${telcod}: ${msg}`);
    }
  });

  if (errors.length > 0) {
    alert(`⚠️ No se pudieron asignar algunos telares:\n\n${errors.join('\n')}\n\nEs posible que estén ocupados por otra sesión.`);
  }

  // 2) Consultar a servidor cuáles quedaron realmente activos
  let activos = [];
  try {
    activos = await api.sesionTelar.listActivos(sescod);
  } catch (e) { console.error(e); }

  // 3) Actualizar store.telares con lo que realmente quedó
  // (Opcional: si quisieras quitar del UI los que fallaron)
}

async function applyHeader() {
  const s = store.session;
  if (!s) {
    Layout.clearTopBar();
    Layout.setSessionButton(false);

    // Wire login button
    const btn = document.getElementById('btnEmpezarTurno');
    if (btn) {
      btn.onclick = async () => {
        await startNewSession();
      };
    }
    return;
  }

  const clockFmt = new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true });
  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '—';
    return clockFmt.format(d);
  };

  Layout.fillTopBar(
    s.tracod ?? '—',
    s.traraz ?? '—',
    s.turno_cod ?? '—',
    fmt(s.inicio_dt)
  );

  Layout.setSessionButton(true);

  // Wire logout button
  const btn = document.getElementById('btnEmpezarTurno');
  if (btn) {
    btn.onclick = async () => {
      if (!confirm('¿Seguro que desea terminar el turno?')) return;
      window._isManualClose = true; // Prevenir alerta de websockets
      try { await snapshotFinYQuitarTelares(); } catch { }
      try { await api.sesiones.cerrar(store.session.sescod); } catch { }
      store.setSession(null);
      await applyHeader();
      renderHome($('#app'));
      Layout.showSingleLayout(); // Volver a single tras logout (o dual si mostramos login inmediatamente?)
      // Si mostramos login inmediatamente:
      setTimeout(() => {
        startNewSession();
      }, 500);
    };
  }
}

async function snapshotFinYQuitarTelares() {
  // Implementación simplificada si es necesaria, 
  // o dejar vacía si el backend maneja el cierre.
  // El original tenía lógica compleja aquí.
}

function wireLayoutActions() {
  document.addEventListener('layout:action', async (e) => {
    const { action, telar } = e.detail;

    if (action === 'select-telares') {
      if (hasSession()) { alert('Para cambiar telares, primero termina tu turno.'); return; }
      const list = await api.telares.list({ activos: true });
      const chosen = await openSelectTelaresModal({
        disponibles: list?.data || list || [],
        max: 2,
        prechecked: store.telares.map(telOf).filter(Boolean)
      });
      if (Array.isArray(chosen)) store.setTelares(chosen);
    }

    else if (action === 'checklist') {
      if (!hasSession()) { alert('Inicia tu turno para revisar el checklist.'); return; }
      Layout.showDualLayout();
      openChecklistReadonly();
    }

    else if (action === 'tickets') {
      if (!hasSession()) { alert('Inicia tu turno para ver pendientes.'); return; }
      TicketsUI.open();
    }

    else if (action === 'llamada') {
      if (!hasSession()) { alert('Inicia tu turno para enviar llamadas.'); return; }
      if (!telar) return alert('Error: Telar no identificado.');
      // Layout.showDualLayout(); // Removed to allow full screen modal overlay
      openCall(telar);
    }

    else if (action === 'encarretadora') {
      if (!hasSession()) { alert('Inicia tu turno para usar Encarretador.'); return; }

      const sessionOpts = [store.telares[0], store.telares[1]].filter(Boolean);
      // Intentar obtener el objeto telar completo
      let tObj = null;
      if (sessionOpts.length > 0) tObj = sessionOpts[0];

      const t = telOf(tObj);
      if (!t) return alert('Selecciona un telar.');

      const telnom = tObj?.telnom || tObj?.alias || `Telar ${t}`;

      if (!confirm(`¿Llamar al ENCARRETADOR para ${telnom}?`)) return;

      try {
        await api.llamadas.crear({
          sescod: store.session.sescod,
          telcod: t,
          categoria: 'EN' // Encarretador
        });
        alert('Alerta de Encarretador enviada.');
      } catch (e) {
        console.error(e);
        alert('Error al enviar alerta.');
      }
    }
  });
}

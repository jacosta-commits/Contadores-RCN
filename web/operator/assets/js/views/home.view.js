// web/operator/assets/js/views/home.view.js
// Vista principal OPERARIO: grilla + helpers + wrappers de acciones.

import { store } from '../state.js';
import { api } from '../api.js';
import { openSelectTelaresModal } from './select-telares.modal.js';
import { openCallModal as openCallModalUI } from './call.modal.js';
import { openPendientesModal as openPendientesModalUI } from './pendientes.modal.js';
import { openChecklistView } from './checklist.view.js';

import {
  renderCounter as ctrRender,
  patchCounter as ctrPatch
} from '../../../../shared/js/ui/counter.js';

const $ = (s, r = document) => r.querySelector(s);

function idPrefixFor(telcod) { return `ctr-${String(telcod)}`; }

function counterHTML(telcod, title) {
  const p = idPrefixFor(telcod);
  // Si viene title (telnom), úsalo. Si no, fallback a "Telar X"
  const display = title ? title : `Telar ${telcod}`;
  const html = ctrRender({ idPrefix: p, title: display });
  return `<section class="counter-wrap" data-telcod="${telcod}">${html}</section>`;
}

export function render(container) {
  const root = container || $('#app') || document.body;
  const telares = store.telares || [];
  const left = telares[0]?.telcod;
  const right = telares[1]?.telcod;

  const modeClass = right ? 'two-columns' : 'single-column';
  const containerMode = right ? 'mode-two' : 'mode-one';

  root.className = modeClass; // Apply class to #app (root)
  root.innerHTML = `
    <div class="panel-contadores">
      <div class="horizontal-container ${containerMode}">
        ${left ? counterHTML(left, telares[0]?.telnom || telares[0]?.alias) : '<div style="color:#666; padding:20px;">Sin telar</div>'}
        ${right ? counterHTML(right, telares[1]?.telnom || telares[1]?.alias) : ''}
      </div>
    </div>
    <div class="panel-turno">
      <!-- Espacio para checklist u otros widgets -->
    </div>
  `;

  // Pegar valores cacheados si existen
  [left, right].filter(Boolean).forEach(t => {
    const vals = store.counters[t] || {};
    patchByTelar(t, vals);
  });

  // Wire SET and RESET double-click/double-tap on each telar
  [left, right].filter(Boolean).forEach(t => {
    wireSetEvent(t);
    wireResetEvent(t);
  });

  refreshHeader();
  return root;
}

export function patchByTelar(telcod, payload = {}) {
  const p = idPrefixFor(telcod);
  const prev = store.counters[telcod] || {};
  const vals = {
    hil_start: payload.hil_start ?? payload.hil_inicio ?? payload.hilInicio ?? prev.hil_start ?? 0,
    hil_turno: payload.hil_turno ?? payload.hilTurno ?? prev.hil_turno ?? 0,
    hil_act: payload.hil_act ?? payload.hilActual ?? payload.hil_acum ?? prev.hil_act ?? 0,
    set_value: payload.set_value ?? payload.set ?? payload.hil_total ?? payload.total ?? prev.set_value ?? 0,
    tarjeta: payload.tarjeta_display ?? payload.tarjeta ?? prev.tarjeta ?? '',
  };
  // cache para modales/resumen
  store.counters = store.counters || {};
  store.counters[telcod] = vals;
  ctrPatch(p, vals);
}

export function refreshTitles() {
  (store.telares || []).forEach((t) => {
    const tel = t?.telcod || t;
    const titleEl = $(`.counter-wrap[data-telcod="${tel}"] .card__title`);
    if (titleEl) titleEl.textContent = t?.telnom || t?.alias || `Telar ${tel}`;
  });
}

/* ===== Acciones de alto nivel ===== */

export async function openChecklist() {
  await ensureSession();
  await ensureTelares();
  await openChecklistView({
    sescod: store.session.sescod,
    telares: (store.telares || []).map(x => x.telcod)
  });
}

export async function openCall(telcod) {
  await ensureSession();
  const t = telcod || store.telares?.[0]?.telcod || store.telares?.[1]?.telcod;
  if (!t) { await ensureTelares(); }
  const tel = telcod || store.telares?.[0]?.telcod || store.telares?.[1]?.telcod;
  if (!tel) return;

  // Buscar nombre bonito en store.telares
  const telObj = (store.telares || []).find(x => (x.telcod || x.key) == tel);
  const telnom = telObj?.telnom || telObj?.alias || null;

  await openCallModalUI({ telcod: tel, sescod: store.session.sescod, telnom });
}

export async function openPendientes() {
  await ensureSession();
  await openPendientesModalUI({ sescod: store.session.sescod });
}

/** Seleccionar telares SOLO si NO hay turno iniciado */
export async function openSelectTelaresStrict() {
  if (store.session?.sescod) {
    alert('No puedes seleccionar telares con un turno activo. Termina el turno primero.');
    return;
  }
  const list = await api.telares.list({ activos: true });
  const chosen = await openSelectTelaresModal({
    disponibles: list?.data || list || [],
    max: 2,
    prechecked: []
  });
  if (chosen) {
    store.setTelares(chosen);
    render($('#app'));
    refreshTitles();
  }
}

/* ===== Helpers ===== */

async function ensureSession() {
  if (store.session?.sescod) return;
  const { runLoginFlow } = await import('./login.view.js');
  await runLoginFlow();
  refreshHeader();
}

async function ensureTelares() {
  if ((store.telares || []).length) return;
  const list = await api.telares.list({ activos: true });
  const chosen = await openSelectTelaresModal({
    disponibles: list?.data || list || [],
    max: 2,
    prechecked: []
  });
  store.setTelares(chosen || []);
  render($('#app'));
  refreshTitles();
}

function refreshHeader() {
  const cod = document.getElementById('hdr-cod');
  const name = document.getElementById('hdr-name');
  const turno = document.getElementById('hdr-turno');
  if (cod) cod.textContent = store.session?.tracod ?? '—';
  if (name) name.textContent = store.session?.traraz ?? '—';
  if (turno) turno.textContent = store.session?.turno_cod ?? '—';
}

/* ===== SET con doble-tap + contraseña ===== */

const SET_PASSWORD = '2475';

function wireSetEvent(telcod) {
  const p = idPrefixFor(telcod);
  const setEl = document.getElementById(`${p}-set`);
  if (!setEl) return;

  // Find the .row parent for better tap target
  const rowEl = setEl.closest('.row');
  const target = rowEl || setEl;

  target.style.cursor = 'pointer';

  target.addEventListener('dblclick', (e) => {
    e.preventDefault();
    handleSetTap(telcod);
  });

  // Double-tap support for mobile (touchend)
  let lastTap = 0;
  target.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 400) {
      e.preventDefault();
      handleSetTap(telcod);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });
}

async function handleSetTap(telcod) {
  // Step 1: Ask for password
  const pwd = await showInputModal('🔒 Contraseña requerida', 'Ingrese la contraseña para modificar el SET:', '', 'password');
  if (pwd === null) return; // cancelled

  if (pwd !== SET_PASSWORD) {
    showAlertModal('⚠️ Acceso denegado', 'Contraseña incorrecta. No tiene permiso para modificar el SET.');
    return;
  }

  // Step 2: Ask for new value
  const val = await showInputModal('📝 Nuevo SET', `Ingrese el nuevo valor de SET para el telar:`, '', 'number');
  if (val === null || val === '') return;

  const num = parseInt(val, 10);
  if (isNaN(num) || num < 0) {
    showAlertModal('⚠️ Valor inválido', 'El valor debe ser un número positivo.');
    return;
  }

  try {
    await api.telares.setTotal(telcod, num);
    showAlertModal('✅ SET actualizado', `SET del telar actualizado a ${num}.`);
  } catch (e) {
    showAlertModal('❌ Error', `No se pudo actualizar: ${e.message}`);
  }
}

/* ===== RESET con doble-tap + contraseña ===== */

function wireResetEvent(telcod) {
  const p = idPrefixFor(telcod);
  const actEl = document.getElementById(`${p}-hact`);
  if (!actEl) return;

  // Find the .row parent for better tap target
  const rowEl = actEl.closest('.row');
  const target = rowEl || actEl;

  target.style.cursor = 'pointer';

  target.addEventListener('dblclick', (e) => {
    e.preventDefault();
    handleResetTap(telcod);
  });

  // Double-tap support for mobile (touchend)
  let lastTap = 0;
  target.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 400) {
      e.preventDefault();
      handleResetTap(telcod);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });
}

async function handleResetTap(telcod) {
  // Step 1: Ask for password
  const pwd = await showInputModal('🔒 Contraseña requerida', 'Ingrese la contraseña para resetear HIL ACUM:', '', 'password');
  if (pwd === null) return; // cancelled

  if (pwd !== SET_PASSWORD) {
    showAlertModal('⚠️ Acceso denegado', 'Contraseña incorrecta. No tiene permiso para resetear.');
    return;
  }

  // Step 2: Confirm action
  if (confirm(`¿Está seguro que desea RESETEAR el acumulado del Telar ${telcod}?`)) {
    try {
      await api.telares.reset(telcod);
      showAlertModal('✅ RESET', `El telar ${telcod} ha sido reseteado correctamente.`);
    } catch (e) {
      showAlertModal('❌ Error', `No se pudo resetear: ${e.message}`);
    }
  }
}

/* ===== Mini Modals (inline, no dependency) ===== */

function showAlertModal(title, message) {
  return new Promise((resolve) => {
    removeModal();
    const overlay = document.createElement('div');
    overlay.id = 'set-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#1a1f2e;border:1px solid #334155;border-radius:16px;padding:24px 28px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);">
        <div style="font-size:1.1rem;font-weight:700;color:#e2e8f0;margin-bottom:12px;">${title}</div>
        <div style="font-size:.95rem;color:#94a3b8;margin-bottom:20px;">${message}</div>
        <button id="set-modal-ok" style="background:#3b82f6;color:white;border:none;border-radius:10px;padding:10px 32px;font-size:1rem;font-weight:600;cursor:pointer;">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#set-modal-ok').onclick = () => { removeModal(); resolve(); };
    overlay.onclick = (e) => { if (e.target === overlay) { removeModal(); resolve(); } };
  });
}

function showInputModal(title, message, defaultVal = '', inputType = 'text') {
  return new Promise((resolve) => {
    removeModal();
    const overlay = document.createElement('div');
    overlay.id = 'set-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#1a1f2e;border:1px solid #334155;border-radius:16px;padding:24px 28px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);">
        <div style="font-size:1.1rem;font-weight:700;color:#e2e8f0;margin-bottom:8px;">${title}</div>
        <div style="font-size:.9rem;color:#94a3b8;margin-bottom:16px;">${message}</div>
        <input id="set-modal-input" type="${inputType}" value="${defaultVal}" 
          style="width:80%;padding:10px 14px;font-size:1.1rem;text-align:center;background:#0f172a;border:1px solid #475569;border-radius:10px;color:#e2e8f0;outline:none;"
          inputmode="${inputType === 'number' ? 'numeric' : 'text'}"
          autocomplete="off" />
        <div style="margin-top:18px;display:flex;gap:12px;justify-content:center;">
          <button id="set-modal-cancel" style="background:#334155;color:#94a3b8;border:none;border-radius:10px;padding:10px 24px;font-size:.95rem;cursor:pointer;">Cancelar</button>
          <button id="set-modal-confirm" style="background:#3b82f6;color:white;border:none;border-radius:10px;padding:10px 24px;font-size:.95rem;font-weight:600;cursor:pointer;">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#set-modal-input');
    setTimeout(() => input.focus(), 100);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { removeModal(); resolve(input.value); }
      if (e.key === 'Escape') { removeModal(); resolve(null); }
    });
    overlay.querySelector('#set-modal-cancel').onclick = () => { removeModal(); resolve(null); };
    overlay.querySelector('#set-modal-confirm').onclick = () => { removeModal(); resolve(input.value); };
  });
}

function removeModal() {
  const old = document.getElementById('set-modal-overlay');
  if (old) old.remove();
}

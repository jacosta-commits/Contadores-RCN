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

  refreshHeader();
  return root;
}

export function patchByTelar(telcod, payload = {}) {
  const p = idPrefixFor(telcod);
  const vals = {
    hil_start: payload.hil_start ?? payload.hil_inicio ?? payload.hilInicio ?? 0,
    hil_turno: payload.hil_turno ?? payload.hilTurno ?? 0,
    hil_act: payload.hil_act ?? payload.hilActual ?? payload.hil_acum ?? 0,
    set_value: payload.set_value ?? payload.set ?? payload.hil_total ?? payload.total ?? 0,
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
  await openCallModalUI({ telcod: tel, sescod: store.session.sescod });
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

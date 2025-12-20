// web/shared/js/ui/counter.js
// Componente de contador (Estilo Contadores_02)

export function renderCounter({ idPrefix, title = '' } = {}) {
  const p = idPrefix || 'ctr';
  return `
    <div class="main-container">
      <div class="title-telar">${title}</div>
      <div class="content-container">
        <div class="display flex-1">
          
          <!-- Fila 1 -->
          <div class="row">
            <div class="row-label">H.INICIO TURNO</div>
            <div class="row-value led-white" id="${p}-hstart">—</div>
          </div>

          <!-- Fila 2 -->
          <div class="row">
            <div class="row-label">HIL TURNO ACTUAL</div>
            <div class="row-value led-yellow" id="${p}-hturno">—</div>
          </div>

          <!-- Fila 3 -->
          <div class="row">
            <div class="row-label">HIL. ACUM.</div>
            <div class="row-value led-red" id="${p}-hact">—</div>
          </div>

          <!-- Fila 4 -->
          <div class="row">
            <div class="row-label">SET</div>
            <div class="row-value led-green" id="${p}-set">—</div>
          </div>

        </div>
      </div>
    </div>
  `;
}

function fmt(n) {
  if (n === undefined || n === null) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString('es-PE');
}

export function patchCounter(idPrefix, data = {}) {
  const qs = id => document.getElementById(`${idPrefix}-${id}`);
  const map = {
    hstart: (data.hil_start ?? data.hilInicio ?? data.hil_inicio),
    hturno: (data.hil_turno ?? data.hilTurno),
    hact: (data.hil_act ?? data.hilActual ?? data.hil_acum),
    set: (data.set_value ?? data.set ?? data.hil_total ?? data.total),
  };
  Object.entries(map).forEach(([k, v]) => {
    const el = qs(k); if (el) el.textContent = fmt(v);
  });
}

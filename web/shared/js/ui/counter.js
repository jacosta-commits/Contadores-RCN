// web/shared/js/ui/counter.js
// Componente de contador (Estilo Contadores_02)

export function renderCounter({ idPrefix, title = '' } = {}) {
  const p = idPrefix || 'ctr';
  return `
    <div class="main-container">
      <div class="title-telar">
        <span class="telar-name">${title}</span>
        <span class="tarjeta-name" id="${p}-tarjeta"></span>
      </div>
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
  const num = parseInt(n, 10);
  if (Number.isNaN(num)) return String(n);
  // Formato industrial: Mínimo 4 dígitos, sin comas (ej: 0123, 5547, 30861)
  return String(num).padStart(4, '0');
}

export function patchCounter(idPrefix, data = {}) {
  const qs = id => document.getElementById(`${idPrefix}-${id}`);
  const map = {
    hstart: (data.hil_start ?? data.hilInicio ?? data.hil_inicio),
    hturno: (data.hil_turno ?? data.hilTurno),
    hact: (data.hil_act ?? data.hilActual ?? data.hil_acum),
    set: (data.set_value ?? data.set ?? data.hil_total ?? data.total),
    tarjeta: data.tarjeta_display ?? data.tarjeta,
  };
  Object.entries(map).forEach(([k, v]) => {
    const el = qs(k);
    if (!el) return;

    if (k === 'tarjeta') {
      el.textContent = v || '';
      return;
    }

    // Direct assignment — no tween animation (prevents jitter and interpolation on reset)
    el.textContent = fmt(v);
  });
}

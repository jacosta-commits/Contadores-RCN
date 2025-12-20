// web/supervisor/assets/js/components/card.component.js
import { api } from '../api.js';

function z4(n) { return String(n ?? 0).padStart(4, '0'); }

export function createCardHTML(t) {
  const telcod = t.telcod;
  const keyLower = String(telcod).toLowerCase();
  const isRashel = keyLower.startsWith('rasch');
  const isShogun = keyLower.startsWith('shogun');
  const isSpecial = isRashel || isShogun;

  // Prioridad absoluta a telnom. Si no existe, usar telcod tal cual.
  // El usuario explícitamente pidió NO armar nombres como "Telar " + código.
  let titulo = t.telnom || t.TELNOM || String(telcod);

  const acumLabel = isRashel ? 'PUNTADAS' : (isShogun ? 'CANT. MALLAS' : 'HIL. ACUM');

  return `
    <div class="main-container" id="card-${telcod}" data-telcod="${telcod}">
      <div class="content-container">
        <!-- Título y velocidad -->
        <div class="title-row">
          <h3 class="title-telar">${titulo}</h3>
          <span class="speed-display" id="speed-${telcod}">-- HPM</span>
        </div>

        <!-- Operario y botón de resumen -->
        <div class="header">
          <span id="operario-${telcod}">(sin operario)</span>
          <button class="arrow-btn btn-resumen" data-telcod="${telcod}">RESUMEN</button>
        </div>
        <div class="session-start-row">
          <span class="session-start-label">INICIO SESIÓN</span>
          <span id="start-time-${telcod}" class="session-start-value">—</span>
        </div>

        <!-- Valores -->
        <div class="display flex-1 ${isSpecial ? 'centered-display' : ''}">
          ${!isSpecial ? `
          <div class="row">
            <div class="row-label">H. INICIO TURNO</div>
            <div class="row-value digit led-blue" id="val-start-${telcod}">0000</div>
          </div>
          <div class="row">
            <div class="row-label">HIL TURNO ACT</div>
            <div class="row-value digit led-yellow" id="val-turno-${telcod}">0000</div>
          </div>` : ``}

          <div class="row" id="row-act-${telcod}">
            <div class="row-label">${acumLabel}</div>
            <div class="row-value digit led-red" id="val-act-${telcod}">0000</div>
          </div>

          <div class="row" id="row-set-${telcod}">
            <div class="row-label">H.TOTAL LOTE</div>
            <div class="row-value digit led-green" id="val-set-${telcod}">0000</div>
          </div>
        </div>
      </div>
      
      <!-- Mini Modal Placeholder (se inyectará dinámicamente si es necesario) -->
      <div id="modal-part-${telcod}" class="mini-modal oculto">
        <div class="mini-modal-content">
          <div id="list-part-${telcod}" class="list-participantes">Cargando...</div>
          <div class="footer-buttons">
            <button class="btn-cancel btn-close-modal" data-telcod="${telcod}">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function updateCard(telcod, data) {
  const card = document.getElementById(`card-${telcod}`);
  if (!card) return;

  // 1. Velocidad
  const speedEl = document.getElementById(`speed-${telcod}`);
  if (speedEl) speedEl.textContent = (data.velocidad > 0) ? `${data.velocidad} HPM` : '-- HPM';

  // 2. Valores
  const valStart = document.getElementById(`val-start-${telcod}`);
  const valTurno = document.getElementById(`val-turno-${telcod}`);
  const valAct = document.getElementById(`val-act-${telcod}`);
  const valSet = document.getElementById(`val-set-${telcod}`);

  if (valStart) valStart.textContent = z4(data.hil_start);
  if (valTurno) valTurno.textContent = z4(data.hil_turno);
  if (valAct) valAct.textContent = z4(data.hil_act);
  if (valSet) valSet.textContent = z4(data.set_value);

  // 3. Operario / Sesión
  const opEl = document.getElementById(`operario-${telcod}`);
  const timeEl = document.getElementById(`start-time-${telcod}`);

  if (data.session_active || data.tracod) {
    card.classList.remove('no-session');
    if (opEl) opEl.innerHTML = formatOperario(data.traraz, data.turno_cod);
    if (timeEl) timeEl.textContent = formatTime(data.inicio_dt); // Asumiendo que viene inicio_dt
  } else {
    card.classList.add('no-session');
    if (opEl) opEl.textContent = '(sin operario)';
    if (timeEl) timeEl.textContent = '—';
  }

  // 4. Coloración SET
  const rowSet = document.getElementById(`row-set-${telcod}`);
  if (rowSet && valSet) {
    const set = data.set_value || 0;
    const act = data.hil_act || 0;

    if (set > 0) {
      if (act >= set) {
        rowSet.style.backgroundColor = "#F44336"; // Rojo
        valSet.style.color = "#fff";
      } else if ((set - act) <= 100) {
        rowSet.style.backgroundColor = "orange"; // Naranja
        valSet.style.color = "#fff";
      } else {
        rowSet.style.backgroundColor = "#323232"; // Gris
        valSet.style.color = "";
      }
    } else {
      rowSet.style.backgroundColor = "#323232";
      valSet.style.color = "";
    }
  }
}

// Helpers
function formatOperario(name, turno) {
  if (!name) return '(sin operario)';
  const parts = name.trim().split(/\s+/);
  const shortName = parts[0] + ' ' + (parts[2] || parts[1] || '');
  return `${shortName}<br>Turno: ${turno || '?'}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

// Eventos (Resumen, Reset, Set)
export function setupCardEvents(telcod) {
  const card = document.getElementById(`card-${telcod}`);
  if (!card) return;

  // Resumen
  const btnResumen = card.querySelector('.btn-resumen');
  if (btnResumen) {
    btnResumen.onclick = async () => {
      const modal = document.getElementById(`modal-part-${telcod}`);
      const list = document.getElementById(`list-part-${telcod}`);
      modal.classList.remove('oculto');

      try {
        list.innerHTML = 'Cargando...';
        const res = await api.util.participantes(telcod);
        const parts = res.participantes || res || [];
        renderParticipantesTable(list, parts);
      } catch (e) {
        list.innerHTML = `<p style="color:red">Error: ${e.message}</p>`;
      }
    };
  }

  // Cerrar Modal
  const btnClose = card.querySelector('.btn-close-modal');
  if (btnClose) {
    btnClose.onclick = () => {
      document.getElementById(`modal-part-${telcod}`).classList.add('oculto');
    };
  }

  // Reset (Doble Click en Acumulado)
  const rowAct = document.getElementById(`row-act-${telcod}`);
  if (rowAct) {
    rowAct.ondblclick = async () => {
      if (confirm(`¿Resetear acumulado del Telar ${telcod}?`)) {
        try { await api.telares.reset(telcod); }
        catch (e) { alert(e.message); }
      }
    };
  }

  // Set Total (Doble Click en Set)
  const rowSet = document.getElementById(`row-set-${telcod}`);
  if (rowSet) {
    rowSet.ondblclick = async () => {
      const val = prompt(`Nuevo SET para Telar ${telcod}:`);
      if (val) {
        try { await api.telares.setTotal(telcod, Number(val)); }
        catch (e) { alert(e.message); }
      }
    };
  }
}

function renderParticipantesTable(container, data) {
  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:#ccc">No hay historial reciente.</p>';
    return;
  }

  const rows = data.slice(0, 15).map(p => `
    <tr>
      <td>${p.nombre || p.traraz || ''}</td>
      <td>${p.turno || ''}</td>
      <td>${p.hilTurno || ''}</td>
      <td>${p.hilAct || ''}</td>
      <td>${new Date(p.timestamp).toLocaleDateString()}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Nombre</th><th>T</th><th>Ini</th><th>Fin</th><th>Fecha</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

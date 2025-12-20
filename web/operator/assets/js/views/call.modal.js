// web/operator/assets/js/views/call.modal.js
// Modal para crear llamadas (tickets) por telar
// Diseño migrado de Contadores_02 (llamada-alerta.css)

import { api } from '../api.js';
import { store } from '../state.js';

const CATS = [
  { k: 'MC', label: 'Mecánico / Calidad' },
  { k: 'M', label: 'Mecánico' },
  { k: 'S', label: 'Supervisor / Auxiliar' },
  { k: 'E', label: 'Electricista' },
  { k: 'Q', label: 'Calidad' },
  // { k: 'G', label: 'Gancho Inferior' }, // Removed per user request
];

export function openCallModal({ telcod, sescod }) {
  return new Promise((resolve) => {
    // Buscar contenedor del telar para posicionamiento relativo
    const container = document.querySelector(`.counter-wrap[data-telcod="${telcod}"]`) || document.body;
    const isRelative = container !== document.body;

    // Crear overlay con scope de estilos
    const overlay = document.createElement('div');
    overlay.className = 'z-overlay llam-scope';

    // Estilos inline para posicionamiento relativo
    if (isRelative) {
      container.style.position = 'relative'; // Asegurar que sea relativo
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.zIndex = '100';
      overlay.style.background = 'rgba(0,0,0,0.85)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.backdropFilter = 'blur(4px)';
      overlay.style.borderRadius = '12px'; // Coincidir con bordes del card
    }

    // Inyectar estilos para selección clara
    const style = document.createElement('style');
    style.textContent = `
      .llam-scope .btnCall.selected {
        background: #00e676 !important;
        color: #000 !important;
        border-color: #00e676 !important;
        box-shadow: 0 0 15px rgba(0, 230, 118, 0.6);
        font-weight: 800;
        transform: scale(1.05);
      }
      .llam-scope .panel-llamada {
        background: #1a2332;
        border: 1px solid #334155;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        max-width: 90%;
        width: 400px;
      }
      .llam-scope h2 {
        color: #fff;
        margin-bottom: 20px;
        font-size: 1.5rem;
        text-align: center;
        border-bottom: 1px solid #334155;
        padding-bottom: 15px;
      }
      .llam-scope .btn-retrocede { display: none; } /* Ocultar flecha fea */
    `;
    overlay.appendChild(style);

    // HTML Structure
    overlay.innerHTML += `
      <!-- Panel de Selección -->
      <div class="panel-llamada" id="panelSelection">
        <h2>Llamada a Telar ${telcod}</h2>
        
        <div class="btn-group-call">
          ${CATS.map(c => `
            <button class="btnCall" data-key="${c.k}" data-label="${c.label}">
              ${c.label}
            </button>
          `).join('')}
        </div>

        <div class="row center" style="margin-top: 24px; gap: 10px;">
          <button id="btnCancel" class="btn btn--danger" style="background: #ef4444;">CANCELAR</button>
          <button id="btnSend" class="btn btn--primary" disabled>ENVIAR ALERTA</button>
        </div>
      </div>
    `;

    container.appendChild(overlay);

    // Logic
    const selected = new Set(); // Stores Keys
    const selectedLabels = new Set(); // Stores Labels for display

    const btnSend = overlay.querySelector('#btnSend');
    const btnCancel = overlay.querySelector('#btnCancel');
    const groupCall = overlay.querySelector('.btn-group-call');

    let activeTickets = []; // IDs of created tickets

    const onClose = () => {
      overlay.remove();
      if (isRelative) container.style.position = ''; // Limpiar estilo
      resolve(null);
    };

    // Toggle categories
    groupCall.addEventListener('click', (e) => {
      if (e.target.classList.contains('btnCall')) {
        const btn = e.target;
        const key = btn.dataset.key;
        const label = btn.dataset.label;

        if (selected.has(key)) {
          selected.delete(key);
          selectedLabels.delete(label);
          btn.classList.remove('selected');
        } else {
          if (selected.size >= 3) {
            alert('Máximo 3 opciones.');
            return;
          }
          selected.add(key);
          selectedLabels.add(label);
          btn.classList.add('selected');
        }

        btnSend.disabled = selected.size === 0;
      }
    });

    // Cancel
    btnCancel.onclick = onClose;

    // Send
    btnSend.onclick = async () => {
      if (btnSend.disabled) return;
      btnSend.textContent = 'ENVIANDO...';
      btnSend.disabled = true;

      try {
        const cats = Array.from(selected).join(',');
        const payload = { sescod, telcod, categoria: cats };
        console.log('[call.modal] Sending payload:', payload);

        // Create tickets (Server sends Telegram)
        const r = await api.llamadas.crear(payload);

        // Handle response (array or single object)
        const created = Array.isArray(r) ? r : [r];
        activeTickets = created.map(x => x.id || x.call_id);

        // Emit event
        store.events.emit('tickets:change');

        // Close this modal and open tickets drawer
        onClose();

        if (window.TicketsUI) {
          window.TicketsUI.open();
          window.TicketsUI.scheduleAutoClose(3000, 'Llamada registrada');
        }

      } catch (err) {
        console.error('[call.modal] Error:', err);
        alert('Error al enviar llamada: ' + (err.message || JSON.stringify(err)));
        btnSend.disabled = false;
        btnSend.textContent = 'ENVIAR ALERTA';
      }
    };
  });
}

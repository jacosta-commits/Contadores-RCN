
import { store } from './state.js';
import { api } from './api.js';

/* ======================================================================================
   LAYOUT MANAGER (Ported from Contadores_02)
   - Handles Header updates (TopBar)
   - Handles Footer generation (renderFooterPorTelares)
   - Injects critical CSS for footer layout
   ====================================================================================== */

export const Layout = {
  // --- Header ---
  fillTopBar(codigo, nombre, turno, hora = "") {
    const lblCodigo = document.getElementById("lblCodigoOperario");
    const lblNombre = document.getElementById("lblNombreOperario");
    const lblTurno = document.getElementById("lblTurnoOperario");
    const lblHora = document.getElementById("lblHoraInicio");
    if (lblCodigo) lblCodigo.textContent = codigo;
    if (lblNombre) lblNombre.textContent = nombre;
    if (lblTurno) lblTurno.textContent = turno;
    if (lblHora) lblHora.textContent = hora;

    const header = document.getElementById("mainHeader");
    if (header) header.classList.remove("oculto");
  },

  clearTopBar() {
    ["lblCodigoOperario", "lblNombreOperario", "lblTurnoOperario", "lblHoraInicio"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
      });

    // Ensure header is visible so the Login button is shown
    const header = document.getElementById("mainHeader");
    if (header) header.classList.remove("oculto");
  },

  setSessionButton(isActive) {
    const btn = document.getElementById("btnEmpezarTurno");
    if (!btn) return;

    // Clonamos para limpiar listeners viejos si fuera necesario, 
    // pero mejor manejamos el texto/clase
    if (isActive) {
      btn.innerHTML = `<span class="icon">✖</span> Terminar Turno`;
      btn.classList.add("btn--danger");
      btn.disabled = false;
    } else {
      btn.innerHTML = `🔑 Iniciar Turno`;
      btn.classList.remove("btn--danger");
      btn.disabled = false; // Habilitado para poder iniciar
    }
  },

  // --- Layout Modes ---
  showSingleLayout() {
    const app = document.getElementById("app");
    if (!app) return;
    app.classList.remove("two-columns");
    app.classList.add("single-column");

    // Ocultar panel lateral si existe
    const turnoPanel = document.querySelector(".panel-turno"); // Usamos clase o ID
    if (turnoPanel) turnoPanel.classList.add("hidden");
  },

  showDualLayout() {
    const app = document.getElementById("app");
    if (!app) return;
    app.classList.remove("single-column");
    app.classList.add("two-columns");

    // Mostrar panel lateral
    const turnoPanel = document.querySelector(".panel-turno");
    if (turnoPanel) turnoPanel.classList.remove("hidden");
  },

  // --- Footer ---
  injectCSS() {
    // CSS crítico para el footer multi-columna y mini-contadores
    // Portado de Contadores_02/public/operario/js/contadores.js
    const css = `
      :root{ --mirror-shift: 14px; }

      /* ---------- Footer multi en fila ---------- */
      #mainFooter { gap: 10px; }
      .footer-multi{
        display: grid;
        grid-template-columns: 1fr max-content 1fr; /* ← CENTRADO REAL */
        align-items: center;
        width: 100%;
        gap: clamp(8px,1.2vmin,14px);
        padding: 0 12px;
        flex: 1 1 auto; /* que se estire dentro del footer */
      }
      .footer-left{ display:flex; gap:12px; grid-column:1; justify-self:start; }
      .footer-center{
        grid-column:2;                 /* ← columna central */
        display:flex;
        gap:clamp(8px,1.2vmin,14px);
        justify-content:center;
        align-items:center;
        flex-wrap: wrap;
        pointer-events: auto;
      }
      .footer-space{ flex:1 1 auto; }

      /* Botones base (mismo look que .btnFooter) */
      .btnFooter, .footer-global-btn{
        width: clamp(120px, calc(var(--footer-h) * 1.6), 260px);
        height: var(--footer-h);
        background:
          linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.00)),
          linear-gradient(180deg, #0f1a2e 0%, #0d1730 100%);
        color:var(--text);
        border:1px solid #22324b;
        border-radius:12px;
        box-shadow: 0 8px 20px rgba(0,0,0,.25);
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:6px; font-size: clamp(13px, 2vmin, 20px); text-align:center; padding:6px; cursor:pointer;
        transition: transform .06s ease, box-shadow .15s ease, border-color .15s ease;
        white-space:normal; word-break:break-word; line-height:1.05;
        font-size: clamp(12px, calc(var(--footer-h) * 0.22), 22px);
      }
      .btnFooter:hover, .footer-global-btn:hover{
        border-color: rgba(96,165,250,.4);
        box-shadow: 0 12px 26px rgba(96,165,250,.18);
      }
      .btnFooter:active, .footer-global-btn:active{ transform: translateY(1px); }
      
      /* Menú Más */
      .footer-more{ position: relative; }
      .btnMore{
        width:  clamp(60px, calc(var(--footer-h) * 0.8), 120px); /* Más pequeño que los principales */
        height: var(--footer-h);
        font-size: clamp(12px, calc(var(--footer-h) * 0.22), 22px);
        background:
          linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.00)),
          linear-gradient(180deg, #0f1a2e 0%, #0d1730 100%);
        color:var(--text);
        border:1px solid #22324b;
        border-radius:12px;
        box-shadow: 0 8px 20px rgba(0,0,0,.25);
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:6px; padding:6px; cursor:pointer;
      }
      .moreMenu{
        position:absolute; left:0; bottom: calc(100% + 8px);
        background:#0f1a2e; border:1px solid var(--border);
        border-radius:12px; box-shadow: var(--shadow-2);
        display:none; min-width: 220px; overflow:hidden; z-index: 1200;
      }
      .moreMenu.open{ display:block; }
      .moreMenu button{
        width:100%; text-align:left; padding:10px 12px;
        background:transparent; color:var(--text); border:0; cursor:pointer;
        font-weight:700; display:flex; align-items:center; gap:8px;
      }
      .moreMenu button:hover{ background:#13233e; }
    `;

    if (!document.getElementById('css-layout-injected')) {
      const tag = document.createElement('style');
      tag.id = 'css-layout-injected';
      tag.textContent = css;
      document.head.appendChild(tag);
    }
  },

  renderFooter(telares = []) {
    const footer = document.getElementById('mainFooter');
    if (!footer) return;

    footer.classList.remove('oculto');
    footer.style.display = 'flex';

    // Limpiar footer (excepto el reloj si queremos preservarlo, pero Contadores_02 lo inyecta dinámicamente o lo tiene estático)
    // En Contadores_02 index.html: <span id="liveClockFooter" ...>
    // Aquí vamos a reconstruir el contenido dinámico

    // Contenedor Multi
    let multiHost = document.getElementById('footerMulti');
    if (!multiHost) {
      multiHost = document.createElement('div');
      multiHost.id = 'footerMulti';
      multiHost.className = 'footer-multi';
      // Insertar al principio
      footer.insertBefore(multiHost, footer.firstChild);
    }

    const isMulti = telares.length > 1;
    const t1 = telares[0] || {};
    const t1Key = t1.telcod || t1.key || '';
    const t1Label = t1.title || t1.telnom || `Telar ${t1Key}`;

    let html = '';

    if (!isMulti) {
      // SINGLE MODE
      html = `
        <div class="footer-left">
          <div class="footer-more">
            <button class="btnMore" id="btnMore">
              <div>⋮</div><div>Más</div>
            </button>
            <div class="moreMenu" id="moreMenu">
              <button id="mmSeleccionar"><span>🧵</span> Seleccionar telares</button>
              <button id="mmChecklist"><span>📝</span> Revisar checklist</button>
            </div>
          </div>
        </div>

        <div class="footer-center">
          <button id="btnTickets" class="btnFooter" title="Pendientes">
            <div>🧾</div><div>Pendientes</div>
            <span id="ticketsBadge" class="tickets-badge">0</span>
          </button>
          <button class="btnFooter" data-act="llamada" data-telar="${t1Key}">📞 Llamada<br>${t1Label}</button>
          <button class="btnFooter" data-act="encarretadora">🧵 Encarretador</button>
        </div>
      `;
    } else {
      // MULTI MODE
      const t2 = telares[1] || {};
      const t2Key = t2.telcod || t2.key || '';
      const t2Label = t2.title || t2.telnom || `Telar ${t2Key}`;

      html = `
        <div class="footer-left">
          <div class="footer-more">
            <button class="btnMore" id="btnMore">
              <div>⋮</div><div>Más</div>
            </button>
            <div class="moreMenu" id="moreMenu">
              <button id="mmSeleccionar"><span>🧵</span> Seleccionar telares</button>
              <button id="mmChecklist"><span>📝</span> Revisar checklist</button>
            </div>
          </div>
        </div>

        <div class="footer-center">
          <button id="btnTickets" class="btnFooter" title="Pendientes">
            <div>🧾</div><div>Pendientes</div>
            <span id="ticketsBadge" class="tickets-badge">0</span>
          </button>
          <button class="btnFooter" data-act="llamada" data-telar="${t1Key}">📞 Llamada<br>${t1Label}</button>
          <button class="btnFooter" data-act="encarretadora">🧵 Encarretador</button>
          <button class="btnFooter" data-act="llamada" data-telar="${t2Key}">📞 Llamada<br>${t2Label}</button>
        </div>
      `;
    }

    multiHost.innerHTML = html;

    // Wiring Events
    this.wireFooterEvents(multiHost);
  },

  wireFooterEvents(host) {
    // Menú Más
    const btnMore = host.querySelector('#btnMore');
    const moreMenu = host.querySelector('#moreMenu');
    if (btnMore && moreMenu) {
      btnMore.onclick = (e) => { e.stopPropagation(); moreMenu.classList.toggle('open'); };
      document.addEventListener('click', () => moreMenu.classList.remove('open'), { passive: true });
    }

    // Botones de acción
    host.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        const telar = btn.dataset.telar;

        if (act === 'llamada') {
          // Emitir evento para que app.js lo maneje
          document.dispatchEvent(new CustomEvent('layout:action', { detail: { action: 'llamada', telar } }));
        } else if (act === 'encarretadora') {
          document.dispatchEvent(new CustomEvent('layout:action', { detail: { action: 'encarretadora' } }));
        }
      };
    });

    // Botón Pendientes
    const btnTickets = host.querySelector('#btnTickets');
    if (btnTickets) {
      btnTickets.onclick = () => {
        document.dispatchEvent(new CustomEvent('layout:action', { detail: { action: 'tickets' } }));
      };
    }

    // Items menú más
    const mmSel = host.querySelector('#mmSeleccionar');
    if (mmSel) mmSel.onclick = () => document.dispatchEvent(new CustomEvent('layout:action', { detail: { action: 'select-telares' } }));

    const mmCheck = host.querySelector('#mmChecklist');
    if (mmCheck) mmCheck.onclick = () => document.dispatchEvent(new CustomEvent('layout:action', { detail: { action: 'checklist' } }));
  },

  updateTicketsBadge(count) {
    const b = document.getElementById('ticketsBadge');
    if (b) {
      b.textContent = count;
      b.style.display = count > 0 ? 'inline-block' : 'none'; // Ajustar display según CSS
    }
    const t = document.getElementById('ticketsCount');
    if (t) t.textContent = `(${count})`;
  },

  startClock() {
    const el = document.getElementById('liveClockFooter');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
    };
    tick();
    setInterval(tick, 1000); // Simple interval for now
  }
};

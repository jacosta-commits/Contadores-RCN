// web/operator/assets/js/views/login.view.js
// Vista de Login: UI "Moderna" (in-page) + Lógica "Backup" (funcional)

import { api } from '../api.js';
import { store } from '../state.js';
import { render as renderHome } from './home.view.js';

export async function runLoginFlow() {
  // 1. Inyectar UI en el panel lateral (Diseño "Bonito")
  const panel = document.querySelector('.panel-turno');
  if (!panel) return;

  panel.innerHTML = `
    <div class="panel panel-login" id="loginPanel">
      <div class="login-card">
        <h2>Iniciar Turno</h2>
        
        <div class="login-field">
          <label>Código de Operario</label>
          <div class="login-input-row">
            <input type="text" id="txtCodigo" placeholder="Ej. 12345" autocomplete="off" autofocus>
            <button id="btnBuscar">Buscar</button>
          </div>
        </div>

        <div class="mensaje" id="mensajeLogin"></div>

        <div class="turno-container oculto" id="turnoContainer">
          <p>Seleccione su turno:</p>
          <div class="turno-buttons" id="turnoButtons">
            <!-- Se llenan dinámicamente -->
          </div>
        </div>

        <button id="btnIniciar" disabled>Iniciar Sesión</button>
      </div>
    </div>
  `;

  // 2. Referencias UI
  const txtCodigo = document.getElementById('txtCodigo');
  const btnBuscar = document.getElementById('btnBuscar');
  const mensajeLogin = document.getElementById('mensajeLogin');
  const turnoContainer = document.getElementById('turnoContainer');
  const turnoButtonsBox = document.getElementById('turnoButtons');
  const btnIniciar = document.getElementById('btnIniciar');

  let operarioValido = false;
  let turnoSeleccionado = null;
  let operarioData = null; // { tracod, traraz }

  // 3. Cargar catálogo de turnos (Lógica Backup)
  try {
    const res = await api.turnos.catalogo();
    const raw = res?.data || res || [];
    // Filtrar activos y ordenar
    const turnos = raw
      .filter(t => (t.activo === undefined || t.activo === 1 || t.activo === true))
      .sort((a, b) => Number(a.turno_cod) - Number(b.turno_cod));

    turnoButtonsBox.innerHTML = '';
    if (turnos && turnos.length) {
      turnos.forEach(t => {
        const b = document.createElement('button');
        b.className = 'btnTurno';
        b.textContent = t.turno_cod; // Solo código, como en backup
        b.title = `${(t.hora_ini || '').slice(0, 5)} - ${(t.hora_fin || '').slice(0, 5)}`;
        b.onclick = () => {
          turnoButtonsBox.querySelectorAll('.btnTurno').forEach(x => x.classList.remove('selected'));
          b.classList.add('selected');
          turnoSeleccionado = t.turno_cod;
          checkReady();
        };
        turnoButtonsBox.appendChild(b);
      });
    } else {
      // Fallback visual
      turnoButtonsBox.innerHTML = '<p>No hay turnos activos.</p>';
    }
  } catch (e) {
    console.error('Error cargando turnos', e);
    turnoButtonsBox.innerHTML = '<p class="text--danger">Error cargando turnos</p>';
  }

  // 4. Buscar Operario (Lógica Backup: api.rrhh.trabajador)
  async function buscar() {
    const cod = txtCodigo.value.trim();
    if (!cod) return;

    mensajeLogin.textContent = 'Buscando...';
    mensajeLogin.className = 'mensaje';

    try {
      // USAMOS LA API CORRECTA DEL BACKUP
      const r = await api.rrhh.trabajador(cod);
      const trabajador = r?.data || r;

      if (trabajador && trabajador.tracod) {
        operarioData = { tracod: trabajador.tracod, traraz: trabajador.traraz };
        operarioValido = true;

        mensajeLogin.textContent = `Hola, ${trabajador.traraz}`;
        mensajeLogin.className = 'mensaje is-ok';

        turnoContainer.classList.remove('oculto');
        txtCodigo.disabled = true;
        btnBuscar.disabled = true;
      } else {
        throw new Error('Operario no encontrado');
      }
    } catch (e) {
      operarioValido = false;
      mensajeLogin.textContent = e.message || 'Operario no encontrado';
      mensajeLogin.className = 'mensaje is-error';
      turnoContainer.classList.add('oculto');
    }
    checkReady();
  }

  btnBuscar.onclick = buscar;
  txtCodigo.onkeydown = (e) => { if (e.key === 'Enter') buscar(); };

  function checkReady() {
    btnIniciar.disabled = !(operarioValido && turnoSeleccionado);
  }

  // 5. Iniciar Sesión (Lógica Backup: api.sesiones.abrir)
  btnIniciar.onclick = async () => {
    if (!operarioValido || !turnoSeleccionado) return;

    btnIniciar.disabled = true;
    btnIniciar.textContent = 'Iniciando...';

    try {
      // USAMOS LA API CORRECTA DEL BACKUP
      const s = await api.sesiones.abrir({
        tracod: operarioData.tracod,
        traraz: operarioData.traraz,
        turno_cod: turnoSeleccionado
      });

      // Actualizar store
      store.setSession({
        sescod: s.sescod || s.id || s.sescod,
        tracod: operarioData.tracod,
        traraz: operarioData.traraz,
        turno_cod: turnoSeleccionado,
        inicio_dt: s.inicio || s.inicio_dt || s.created_at || new Date().toISOString(),
      });

      // Éxito: Recargar/Renderizar home
      // Nota: app.js escucha 'session:change' y hará el resto (asignar telares, etc.)
      renderHome();

    } catch (e) {
      console.error(e);
      btnIniciar.disabled = false;
      btnIniciar.textContent = 'Iniciar Sesión';
      alert('Error al iniciar sesión: ' + (e.message || 'Error desconocido'));
    }
  };
}

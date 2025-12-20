// web/operator/assets/js/views/checklist.view.js
// Vista de Checklist (Diseño Contadores_02)

import { api } from '../api.js';
import { store } from '../state.js';
import { Layout } from '../layout.js';

export async function openChecklistView({ sescod, telares, readonly = false }) {
  const panel = document.querySelector('.panel-turno');
  if (!panel) return;

  // Normalize sescod
  sescod = Number(sescod ?? store.session?.sescod ?? NaN);
  if (!Number.isFinite(sescod)) {
    alert('No hay sesión activa para guardar el checklist.');
    return;
  }

  // Normalize telares: ensure we have strings (codes)
  const tels = (telares || [])
    .map(t => (typeof t === 'object' ? (t.telcod ?? t.tel ?? t.key) : t))
    .filter(Boolean);

  if (tels.length === 0) {
    alert('No hay telares para mostrar.');
    return;
  }

  const preguntas = [
    { id: 'q1', key: 'rodillo_principal', text: "¿Hilos mal pasados en rodillo principal?" },
    { id: 'q2', key: 'sensores_urdimbre', text: "¿Hilos en Sensores Urdimbre OK?" },
    { id: 'q3', key: 'hilos_fondo', text: "¿Rodillos Tensión - Fondo OK?" },
    { id: 'q4', key: 'hilos_refuerzo', text: "¿Rodillos Tensión - Refuerzo OK?" },
    { id: 'q5', key: 'encarretadora', text: "¿Encarretadora limpia?" },
    { id: 'q6', key: 'manchas_aceite', text: "¿Manchas de aceite en el piso?" }
  ];

  const telarCols = tels.length;
  const title = readonly ? 'Checklist (Solo Lectura)' : 'Checklist de Inicio';
  const btnText = readonly ? 'Cerrar' : 'Guardar Checklist';

  // HTML Structure matching login-checklist.css
  panel.innerHTML = `
    <div class="panel panel-checklists" id="checklistsPanel">
      <h2 id="checklistTitle">${title}</h2>
      
      <div class="table-checklists" style="--telar-cols: ${telarCols}">
        <!-- Header Row -->
        <div class="row header-row">
          <div class="cell cell-pregunta">Pregunta</div>
          ${tels.map(t => `<div class="cell cell-telar">Telar ${t}</div>`).join('')}
        </div>

        <!-- Questions Rows -->
        ${preguntas.map(q => `
          <div class="row" data-qid="${q.id}">
            <div class="cell cell-pregunta">${q.text}</div>
            ${tels.map(t => `
              <div class="cell cell-telar" data-telar="${t}">
                <button class="btnSi" data-val="SI" ${readonly ? 'disabled' : ''}>SI</button>
                <button class="btnNo" data-val="NO" ${readonly ? 'disabled' : ''}>NO</button>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>

      <div class="guardar-row">
        <button id="btnGuardarAll" ${readonly ? '' : 'disabled'}>${btnText}</button>
      </div>
    </div>
  `;

  // Logic
  const respuestas = {}; // { q1: { t1: 'SI', t2: 'NO' }, ... }
  const btnGuardar = document.getElementById('btnGuardarAll');

  // Initialize answers structure
  preguntas.forEach(q => {
    respuestas[q.id] = {};
    tels.forEach(t => respuestas[q.id][t] = null);
  });

  // If readonly, fetch data
  if (readonly) {
    try {
      for (const t of tels) {
        const res = await api.checklist.get({ sescod, telcod: t });
        const data = res?.data || res || {};
        // Map DB keys to questions
        preguntas.forEach(q => {
          const val = data[q.key]; // 'SI' or 'NO'
          if (val) {
            respuestas[q.id][t] = val;
            // Update UI
            const row = panel.querySelector(`.row[data-qid="${q.id}"]`);
            const cell = row.querySelector(`.cell-telar[data-telar="${t}"]`);
            if (val === 'SI') cell.querySelector('.btnSi').classList.add('selected');
            if (val === 'NO') cell.querySelector('.btnNo').classList.add('selected');
          }
        });
      }
    } catch (e) {
      console.error('[checklist] error fetching data', e);
    }

    // Wire close button
    btnGuardar.onclick = () => {
      panel.innerHTML = '';
      Layout.showSingleLayout();
    };
    return; // Stop here for readonly
  }

  // Event delegation for buttons (Write mode)
  const table = document.querySelector('.table-checklists');
  table.addEventListener('click', (e) => {
    if (readonly) return;
    if (e.target.classList.contains('btnSi') || e.target.classList.contains('btnNo')) {
      const btn = e.target;
      const cell = btn.closest('.cell-telar');
      const row = btn.closest('.row');
      const qid = row.dataset.qid;
      const telar = cell.dataset.telar;
      const val = btn.dataset.val;

      // Update state
      respuestas[qid][telar] = val;

      // Update UI
      cell.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      checkCompletion();
    }
  });

  function checkCompletion() {
    let complete = true;
    for (const qid in respuestas) {
      for (const t in respuestas[qid]) {
        if (!respuestas[qid][t]) complete = false;
      }
    }
    btnGuardar.disabled = !complete;
  }

  btnGuardar.onclick = async () => {
    if (btnGuardar.disabled) return;
    btnGuardar.textContent = 'Guardando...';
    btnGuardar.disabled = true;

    try {
      // Send one request per telar
      for (const t of tels) {
        const payload = {
          sescod: sescod,
          telcod: t,
          rodillo_principal: respuestas['q1'][t],
          sensores_urdimbre: respuestas['q2'][t],
          hilos_fondo: respuestas['q3'][t],
          hilos_refuerzo: respuestas['q4'][t],
          encarretadora: respuestas['q5'][t],
          manchas_aceite: respuestas['q6'][t]
        };
        await api.checklist.upsert(payload);
      }

      alert('Checklist guardado correctamente.');

      // Close checklist view (clear panel or go to "Review Mode")
      panel.innerHTML = '';
      Layout.showSingleLayout(); // Revert to single layout

    } catch (e) {
      console.error(e);
      alert('Error al guardar: ' + (e.message || e.error || JSON.stringify(e)));
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar Checklist';
    }
  };
}

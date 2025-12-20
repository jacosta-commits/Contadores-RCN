// Modal: seleccionar 1–2 telares (muestra TELNOM/Alias). Simple, con búsqueda y max.
// Devuelve siempre: [{ telcod, label }] para que encaje con store.setTelares(...)

export function openSelectTelaresModal({ disponibles = [], max = 2, prechecked = [] } = {}) {
  // Normaliza dataset y ordena: activos primero, luego orden "natural"
  const list = (disponibles || [])
    .map(d => ({
      telcod: String(d.telcod || d.TELCOD || d.id || d.tel || '').trim(),
      telnom: d.telnom || d.TELNOM || d.alias || d.ALIAS || d.nombre || d.name || null,
      activo: (d.activo ?? d.ACTIVO ?? true) ? true : false,
      grupo: d.grupo || d.GRUPO || null,
    }))
    .filter(x => x.telcod)
    .sort((a, b) => {
      // activos primero
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      // orden natural por número si aplica
      const na = Number(a.telcod), nb = Number(b.telcod);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.telcod).localeCompare(String(b.telcod), 'es', { numeric: true });
    });

  // set de preseleccionados (strings)
  const pre = new Set(prechecked.map(String));

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'modal-host';
    host.innerHTML = `
      <div class="modal is-open" id="stl-modal">
        <div class="modal__backdrop"></div>
        <div class="modal__dialog modal__dialog--md">
          <div class="modal__head">
            <div class="modal__title">Seleccionar telares (máx. ${max})</div>
            <button class="modal__close" id="mdl-close" title="Cerrar">✖</button>
          </div>

          <div class="modal__body">
            ${list.length === 0 ? `
              <div class="muted">No hay telares disponibles.</div>
            ` : `
              <div class="row" style="gap:8px;margin-bottom:10px;">
                <input id="stl-q" class="input" placeholder="Buscar por código o nombre…" style="flex:1;min-width:180px;" />
                <span id="sel-hint" class="text--muted" style="align-self:center;">0/${max} seleccionados</span>
              </div>

              <div class="grid grid--2" id="grid-list" style="max-height:50vh;overflow:auto;">
                ${list.map(it => {
      const id = `st-${CSS.escape(it.telcod)}`;
      const checked = pre.has(it.telcod) ? 'checked' : '';
      const disabled = it.activo ? '' : 'disabled data-locked="1"';
      const labelTxt = it.telnom ? `${it.telnom} · ${it.telcod}` : it.telcod;
      const badge = it.grupo ? `<small class="text--muted" style="margin-left:6px;opacity:.75;">${it.grupo}</small>` : '';
      return `
                    <label class="card card--select" for="${id}">
                      <input id="${id}" class="sel-cb" type="checkbox" data-t="${it.telcod}" ${checked} ${disabled} />
                      <div class="card__body" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                        <span>${labelTxt}${badge}</span>
                        ${!it.activo ? '<span class="text--muted" title="Inactivo">🔒</span>' : ''}
                      </div>
                    </label>
                  `;
    }).join('')}
              </div>
            `}
          </div>

          <div class="modal__foot">
            <button class="btn btn--ghost" id="cancel">Cancelar</button>
            <button class="btn" id="ok" disabled>Usar</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(host);
    const $ = s => host.querySelector(s);
    const $$ = s => [...host.querySelectorAll(s)];

    const inputs = $$('input.sel-cb[data-t]');
    const ok = $('#ok');
    const hint = $('#sel-hint');
    const q = $('#stl-q');

    const close = (val = null) => { host.remove(); resolve(val); };

    // Cierre por backdrop o tecla ESC
    $('#stl-modal')?.addEventListener('click', (e) => {
      if (e.target.classList?.contains('modal__backdrop')) close(null);
    });
    host.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });

    $('#cancel')?.addEventListener('click', () => close(null));
    $('#mdl-close')?.addEventListener('click', () => close(null));

    function refreshState() {
      const selected = inputs.filter(i => i.checked);
      if (hint) hint.textContent = `${selected.length}/${max} seleccionados`;

      inputs.forEach(i => {
        const locked = i.dataset.locked === '1';
        if (locked) { i.disabled = true; return; }
        i.disabled = selected.length >= max && !i.checked;
      });
      ok.disabled = selected.length === 0;
    }

    // Búsqueda rápida
    function applyFilter() {
      const term = (q?.value || '').trim().toLowerCase();
      const cards = $$('#grid-list .card');
      cards.forEach(card => {
        const input = card.querySelector('input.sel-cb');
        const item = list.find(x => x.telcod === input.dataset.t);
        const text = `${item.telcod} ${item.telnom || ''} ${item.grupo || ''}`.toLowerCase();
        card.style.display = term ? (text.includes(term) ? '' : 'none') : '';
      });
    }

    inputs.forEach(i => i.addEventListener('change', refreshState));
    q?.addEventListener('input', applyFilter);

    // Atajo: doble click sobre tarjeta = toggle inmediato
    $$('#grid-list .card').forEach(c => {
      c.addEventListener('dblclick', (e) => {
        const cb = c.querySelector('input.sel-cb');
        if (cb && !cb.disabled) { cb.checked = !cb.checked; refreshState(); }
      });
    });

    // Estado inicial
    refreshState();

    ok?.addEventListener('click', () => {
      const chosen = inputs
        .filter(i => i.checked)
        .map(i => {
          const item = list.find(x => x.telcod === i.dataset.t);
          return { telcod: item.telcod, telnom: item.telnom || null, alias: item.telnom || null }; // 👈 encaja con store.setTelares
        });
      close(chosen);
    });
  });
}

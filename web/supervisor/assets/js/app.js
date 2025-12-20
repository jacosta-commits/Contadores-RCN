// web/supervisor/assets/js/app.js
import { api } from './api.js';
import { init as wsInit, joinRooms } from './ws.js';
import { store } from './state.js';
import { createCardHTML, updateCard, setupCardEvents } from './components/card.component.js';
import { initNavigator } from './navigator.js';

// Elementos UI
const containers = {
    Anchoveteros: document.getElementById('anchoveteros-cards'),
    Consumo: document.getElementById('consumo-cards'),
    Rashell: document.getElementById('rashell-cards'),
    Muketsu: document.getElementById('muketsu-cards'),
};

const tabs = document.querySelectorAll('.group-btn');
const groups = document.querySelectorAll('.group-container');

// Inicialización
async function bootstrap() {
    console.log('[Supervisor] Iniciando...');

    // 2. Iniciar WS (antes de unirse a rooms)
    wsInit({
        onState: (payload) => {
            store.updateCounter(payload.telcod, payload);
        }
    });

    // 1. Cargar Telares
    try {
        const res = await api.telares.list({ activos: true });
        const telares = Array.isArray(res) ? res : (res.data || []);
        store.setTelares(telares);
        renderGrid(telares);

        // Unirse a WS Rooms
        const codes = telares.map(t => t.telcod);
        joinRooms(codes);

    } catch (e) {
        console.error('Error cargando telares:', e);
        alert('Error cargando telares. Revisa consola.');
    }

    // 3. Suscribirse a cambios del Store para actualizar UI
    store.subscribe((type, detail) => {
        if (type === 'counter') {
            const data = store.counters[detail];
            updateCard(detail, data);
        }
    });

    // 4. UI Events (Tabs)
    setupTabs();
    setupFilter();
}

function renderGrid(telares) {
    // Limpiar contenedores
    Object.values(containers).forEach(c => c.innerHTML = '');

    telares.forEach(t => {
        // Determinar grupo (fallback a Anchoveteros si no tiene)
        // La lógica de asignación de grupo puede venir del backend o inferirse
        // Aquí usaremos t.grupo si existe, o lógica simple
        let grp = t.grupo || 'Anchoveteros';

        // Normalizar nombres de grupos para coincidir con containers keys
        if (grp.includes('Ras')) grp = 'Rashell';
        else if (grp.includes('Muk')) grp = 'Muketsu';
        else if (grp.includes('Con')) grp = 'Consumo';
        else grp = 'Anchoveteros';

        const container = containers[grp];
        if (container) {
            container.innerHTML += createCardHTML(t);
            // Defer event setup to after render
            setTimeout(() => setupCardEvents(t.telcod), 0);
        }
    });
}

function setupTabs() {
    tabs.forEach(btn => {
        btn.onclick = () => {
            // Toggle active state
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Show/Hide containers
            const targetGrp = btn.dataset.group;
            groups.forEach(g => {
                if (g.id === `group${targetGrp}`) g.classList.add('active');
                else g.classList.remove('active');
            });
        };
    });
}

function setupFilter() {
    const input = document.getElementById('telarFilter');
    if (!input) return;

    input.oninput = (e) => {
        const val = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.main-container');

        cards.forEach(c => {
            const telcod = c.dataset.telcod.toLowerCase();
            if (telcod.includes(val)) c.style.display = '';
            else c.style.display = 'none';
        });
    };
}

// Start
bootstrap();

// web/supervisor/assets/js/navigator.js
// Menú hamburguesa para Supervisor

export function initNavigator() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const sideMenu = document.getElementById('sideMenu');
    const menuHpo = document.getElementById('menuHpo');

    if (!hamburgerMenu || !sideMenu) return;

    const openMenu = () => { hamburgerMenu.classList.add('active'); sideMenu.classList.add('active'); };
    const closeMenu = () => { hamburgerMenu.classList.remove('active'); sideMenu.classList.remove('active'); };
    const toggleMenu = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (sideMenu.classList.contains('active')) closeMenu(); else openMenu();
    };

    // Listener del ícono hamburguesa
    if (window.PointerEvent) {
        hamburgerMenu.addEventListener('pointerup', toggleMenu);
    } else {
        hamburgerMenu.addEventListener('click', toggleMenu);
        hamburgerMenu.addEventListener('touchend', function (e) { e.preventDefault(); toggleMenu(e); });
    }

    // Cerrar al hacer click fuera del drawer
    document.addEventListener('click', (e) => {
        if (!sideMenu.classList.contains('active')) return;
        if (sideMenu.contains(e.target) || hamburgerMenu.contains(e.target)) return;
        closeMenu();
    });

    // Cerrar con ESC
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sideMenu.classList.contains('active')) closeMenu();
    });

    // Opción: Hileras por Turno
    function handleHpoOption(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        closeMenu();
        // Evento global para enganchar la acción más adelante
        window.dispatchEvent(new CustomEvent('menu:hileras-por-turno'));
        console.log('[Menú] Hileras por Turno');
        alert('Funcionalidad "Hileras por Turno" pendiente de implementación.');
    }

    if (menuHpo) {
        if (window.PointerEvent) {
            menuHpo.addEventListener('pointerup', handleHpoOption);
        } else {
            menuHpo.addEventListener('click', handleHpoOption);
            menuHpo.addEventListener('touchend', function (e) { e.preventDefault(); handleHpoOption(e); });
        }
    }
}

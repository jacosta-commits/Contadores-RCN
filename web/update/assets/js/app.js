// Admin Update View - Main App Logic
const btn = document.getElementById('btnBroadcastReload');
const status = document.getElementById('status');

btn.onclick = async () => {
    // Confirm action
    if (!confirm('¿Seguro que deseas actualizar TODAS las vistas de operator y supervisor?\n\nEsto refrescará todas las tablets conectadas.')) {
        return;
    }

    btn.disabled = true;
    status.textContent = 'Enviando señal de actualización...';
    status.style.color = '#ffa500';
    status.style.background = 'rgba(255, 165, 0, 0.1)';

    try {
        const res = await fetch('/api/v1/admin/broadcast-reload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (data.ok) {
            status.style.color = '#00ff00';
            status.style.background = 'rgba(0, 255, 0, 0.1)';
            status.textContent = '✅ ' + data.message;
        } else {
            status.style.color = '#ff4444';
            status.style.background = 'rgba(255, 68, 68, 0.1)';
            status.textContent = '❌ Error: ' + data.error;
        }
    } catch (e) {
        status.style.color = '#ff4444';
        status.style.background = 'rgba(255, 68, 68, 0.1)';
        status.textContent = '❌ Error de red: ' + e.message;
    } finally {
        btn.disabled = false;

        // Clear status after 5 seconds
        setTimeout(() => {
            status.textContent = '';
            status.style.background = 'transparent';
        }, 5000);
    }
};

// Log ready
console.log('[Admin Update] Panel listo');

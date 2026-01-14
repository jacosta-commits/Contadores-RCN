
const activeTweens = new WeakMap();

/**
 * Anima el contenido de texto de un elemento numérico.
 * @param {HTMLElement} element - Elemento a animar
 * @param {number} targetValue - Valor final
 * @param {number} duration - Duración en ms (default 300)
 * @param {function} formatter - Función para formatear el número (opcional)
 */
export function tween(element, targetValue, duration = 300, formatter = null) {
    if (!element) return;

    // Parsear valor actual (limpiar no numéricos)
    const currentText = element.textContent.replace(/[^0-9]/g, '');
    const startValue = parseInt(currentText, 10) || 0;
    const endValue = parseInt(targetValue, 10) || 0;

    if (startValue === endValue) {
        if (formatter) element.textContent = formatter(endValue);
        return;
    }

    // Cancelar animación previa en este elemento
    if (activeTweens.has(element)) {
        cancelAnimationFrame(activeTweens.get(element));
    }

    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Interpolación lineal
        const current = Math.floor(startValue + (endValue - startValue) * progress);

        // Aplicar formato
        element.textContent = formatter ? formatter(current) : current;

        if (progress < 1) {
            const id = requestAnimationFrame(update);
            activeTweens.set(element, id);
        } else {
            activeTweens.delete(element);
            // Asegurar valor final exacto
            element.textContent = formatter ? formatter(endValue) : endValue;
        }
    }

    const id = requestAnimationFrame(update);
    activeTweens.set(element, id);
}

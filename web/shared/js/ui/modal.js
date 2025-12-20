// web/shared/js/ui/modal.js
// Utilidades para abrir/cerrar modales rápidos

export function openModal({ title = '', bodyHTML = '', size = 'md', footerHTML = '' } = {}) {
  const root = ensureRoot();
  root.innerHTML = `
    <div class="modal is-open">
      <div class="modal__dialog modal__dialog--${size}">
        <div class="modal__head">
          <div class="modal__title">${title}</div>
          <button class="modal__close" id="mdl-close">✖</button>
        </div>
        <div class="modal__body">${bodyHTML}</div>
        <div class="modal__foot">${footerHTML}</div>
      </div>
    </div>
  `;
  root.querySelector('#mdl-close').addEventListener('click', closeModal);
  return root;
}

export function closeModal(){
  const root = document.getElementById('modal-root') || document.querySelector('[data-modal-root]');
  if (root) root.innerHTML = '';
}

function ensureRoot(){
  let root = document.getElementById('modal-root') || document.querySelector('[data-modal-root]');
  if (!root){
    root = document.createElement('div');
    root.id = 'modal-root';
    document.body.appendChild(root);
  }
  return root;
}

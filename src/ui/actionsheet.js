// Bottom action sheet for the press-and-hold menu. One open at a time.
import { h, icon } from './dom.js';

let onEscHandler = null;

/**
 * @param {{ title?: string, subtitle?: string, items: { icon?: string, label: string, danger?: boolean, onSelect: () => void }[], cancelLabel: string }} opts
 */
export function openActionSheet({ title, subtitle, items, cancelLabel }) {
  closeActionSheet();
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: closeActionSheet });
  const sheet = h('div', { class: 'sheet', role: 'menu', 'aria-label': title ?? cancelLabel },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    title ? h('div', { class: 'sheet-head' },
      h('p', { class: 'sheet-title' }, title),
      subtitle ? h('p', { class: 'sheet-sub small muted' }, subtitle) : null) : null,
    h('div', { class: 'sheet-items' }, items.map((it) => h('button', {
      class: `sheet-item${it.danger ? ' is-danger' : ''}`, type: 'button', role: 'menuitem',
      onclick: () => { closeActionSheet(); it.onSelect(); },
    }, it.icon ? icon(it.icon, 20) : null, h('span', {}, it.label)))),
    h('button', { class: 'sheet-item sheet-cancel', type: 'button', onclick: closeActionSheet }, cancelLabel));
  document.body.append(backdrop, sheet);
  // Two frames: the browser needs the elements painted at their start state before transitioning.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  }));
  onEscHandler = (e) => { if (e.key === 'Escape') closeActionSheet(); };
  document.addEventListener('keydown', onEscHandler);
}

export function closeActionSheet() {
  document.querySelectorAll('.sheet-backdrop, .sheet').forEach((el) => el.remove());
  if (onEscHandler) { document.removeEventListener('keydown', onEscHandler); onEscHandler = null; }
}

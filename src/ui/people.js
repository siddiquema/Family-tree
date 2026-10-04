// Shared ways of naming and listing people.
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { state, canEdit } from '../data/store.js';
import { onLongPress } from './longpress.js';
import { openPersonMenu } from './person-menu.js';

export function displayName(p) {
  if (!p) return '';
  if (!p.name_known) return t('common.nameUnknown');
  return p.id === state.meId ? `${p.full_name} (${t('common.you')})` : p.full_name;
}

/** "1932 – 2004", "b. 1988", "– 1972" or "" */
export function years(p) {
  if (p.birth_year && p.death_year) return `${p.birth_year} – ${p.death_year}`;
  if (p.death_year) return `– ${p.death_year}`;
  if (p.birth_year) return p.is_living === false ? `${p.birth_year} –` : `${p.birth_year}`;
  return '';
}

export function initials(p) {
  if (!p?.name_known) return '?';
  return p.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function avatar(p, size = 'md') {
  return h('span', { class: `avatar avatar-${size}${p.is_living === false ? ' is-late' : ''}${p.id === state.meId ? ' is-me' : ''}`, 'aria-hidden': 'true' }, initials(p));
}

/** A tappable chip linking to a profile. Press and hold opens edit/add/remove, if allowed. */
export function personChip(p, extra) {
  const editable = canEdit(p.id);
  const el = h('a', { class: `chip${p.is_living === false ? ' is-late' : ''}${editable ? ' is-editable' : ''}`, href: `#/person/${p.id}` },
    avatar(p, 'sm'),
    h('span', { class: 'chip-text' },
      h('span', { class: `chip-name${p.name_known ? '' : ' is-unknown'}` }, displayName(p)),
      extra ? h('span', { class: 'chip-sub' }, extra) : null));
  if (editable) onLongPress(el, () => openPersonMenu(p.id));
  return el;
}

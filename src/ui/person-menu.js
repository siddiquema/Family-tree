// Press-and-hold menu: edit, add parent/child/spouse, remove (§5 + the admin-only delete rule).
// Shown only for people the viewer can edit — the same test the database enforces.
import { t } from '../i18n/index.js';
import { openActionSheet } from './actionsheet.js';
import { toast } from './dom.js';
import {
  person, graph, canEdit, canAddParentTo, canDelete, linkCountOf, addFamilyMember, deletePerson,
} from '../data/store.js';

function nameOf(p) {
  return p.name_known ? p.full_name : t('common.nameUnknown');
}

/** Opens the menu for `id`, if the viewer has any rights over this person. No-op otherwise. */
export function openPersonMenu(id) {
  const p = person(id);
  if (!p || !canEdit(id)) return;
  const g = graph();
  const items = [
    { icon: 'edit', label: t('menu.edit'), onSelect: () => { location.hash = `#/person/${id}?edit=1`; } },
  ];
  if (canAddParentTo(id)) items.push({ icon: 'plus', label: t('menu.addParent'), onSelect: () => addAndEdit(id, 'parent') });
  items.push({ icon: 'plus', label: t('menu.addChild'), onSelect: () => addAndEdit(id, 'child') });
  if (!g.spousesOf(id).some((sp) => sp.status === 'married')) {
    items.push({ icon: 'plus', label: t('menu.addSpouse'), onSelect: () => addAndEdit(id, 'spouse') });
  }
  if (canDelete(id)) items.push({ icon: 'trash', label: t('menu.remove'), danger: true, onSelect: () => confirmRemove(id) });

  openActionSheet({ title: nameOf(p), items, cancelLabel: t('common.cancel') });
}

function addAndEdit(id, kind) {
  const newPersonId = addFamilyMember(id, kind);
  if (newPersonId) location.hash = `#/person/${newPersonId}?edit=1`;
}

function confirmRemove(id) {
  const p = person(id);
  const linked = linkCountOf(id);
  openActionSheet({
    title: t('menu.removeConfirmTitle', { name: nameOf(p) }),
    subtitle: linked ? t('menu.removeConfirmBody', { n: linked, s: linked === 1 ? '' : 's' }) : null,
    items: [{
      icon: 'trash', label: t('menu.removeConfirmAction'), danger: true,
      onSelect: () => {
        const ok = deletePerson(id);
        if (ok) {
          toast(t('menu.removed', { name: nameOf(p) }));
          if (location.hash.startsWith(`#/person/${id}`)) location.hash = '#/';
        }
      },
    }],
    cancelLabel: t('common.cancel'),
  });
}

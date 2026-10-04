import { h, icon, toast } from '../ui/dom.js';
import { t, formatDate } from '../i18n/index.js';
import { state, person, reviewEdit, setVerified, signOut, isAdmin, exportFamilyCSV, importFamilyCSV } from '../data/store.js';
import { displayName } from '../ui/people.js';
import { downloadText } from '../ui/download.js';

export function adminView() {
  if (!isAdmin()) return h('main', { class: 'page' }, h('p', { class: 'card muted' }, t('admin.noneWaiting')));
  const pending = state.editRequests.filter((r) => r.status === 'pending');
  const done = state.editRequests.filter((r) => r.status !== 'pending').slice(0, 3);
  const missing = [...state.missing.entries()].sort((a, b) => b[1] - a[1]);

  return h('main', { class: 'page' },
    h('header', { class: 'page-head row-between' },
      h('h1', {}, t('admin.title')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { signOut(); location.hash = '#/login'; } }, t('admin.signOut'))),

    dataSection(),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.approvals')),
      pending.length ? pending.map((r) => editCard(r)) : h('p', { class: 'card muted' }, t('admin.noneWaiting')),
      done.map((r) => h('p', { class: 'small muted done-line' },
        `${displayName(person(r.target_person_id))}: ${t(r.status === 'approved' ? 'admin.approved' : 'admin.rejected')}`))),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.terms')),
      h('p', { class: 'small muted' }, t('admin.termsNote')),
      h('div', { class: 'card terms' }, state.terms.map((term) => h('div', { class: 'term' },
        h('code', { class: 'term-path' }, term.path),
        h('div', { class: 'term-labels' },
          h('span', {}, term.label_en),
          h('span', { class: 'muted' }, term.label_ta_formal),
          term.label_ta_local
            ? h('span', { class: term.is_verified ? 'term-local is-verified' : 'term-local' },
              `${term.label_ta_local}${term.label_ta_local_roman ? ` (${term.label_ta_local_roman})` : ''}`)
            : h('span', { class: 'small muted' }, t('admin.noLocal'))),
        term.label_ta_local
          ? h('button', { class: `btn btn-sm ${term.is_verified ? 'btn-ghost' : 'btn-primary'}`, type: 'button',
            onclick: () => setVerified(term.path, !term.is_verified) },
          term.is_verified ? t('admin.undo') : t('admin.confirm'))
          : null)))),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.missing')),
      missing.length
        ? h('ul', { class: 'card plain-list' }, missing.map(([path, n]) => h('li', {}, h('code', {}, path), ' ', h('span', { class: 'small muted' }, t('admin.lookups', { n })))))
        : h('p', { class: 'small muted' }, t('admin.missingNone'))),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.members')),
      h('ul', { class: 'card plain-list' }, state.members.map((m) => h('li', { class: 'row-between' },
        h('a', { href: `#/person/${m.person_id}` }, displayName(person(m.person_id))),
        h('span', { class: 'small muted' }, t(`role.${m.role}`)))))));
}

/** Family-data export (CSV, for Excel) and import. Admin only (adminView already gates the page). */
function dataSection() {
  const picked = { persons: null, relationships: null };
  const errorsBox = h('ul', { class: 'small import-errors', hidden: true });
  const importBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, t('admin.dataImportAction'));

  const refreshReady = () => { importBtn.disabled = !(picked.persons && picked.relationships); };
  const onPick = (key) => async (e) => {
    const file = e.target.files[0];
    picked[key] = file ? await file.text() : null;
    refreshReady();
  };
  importBtn.onclick = () => {
    const result = importFamilyCSV(picked.persons, picked.relationships);
    if (!result.ok) {
      errorsBox.hidden = false;
      errorsBox.replaceChildren(...result.errors.slice(0, 20).map((msg) => h('li', {}, msg)),
        result.errors.length > 20 ? h('li', { class: 'muted' }, t('admin.dataMoreErrors', { n: result.errors.length - 20 })) : null);
      return;
    }
    errorsBox.hidden = true;
    errorsBox.replaceChildren();
    toast(t('admin.dataImported', { people: result.people, relationships: result.relationships }));
  };

  return h('section', {},
    h('h2', { class: 'section-title' }, t('admin.dataTitle')),
    h('div', { class: 'card' },
      h('p', { class: 'small muted' }, t('admin.dataExportNote')),
      h('div', { class: 'row', style: 'justify-content:flex-start' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => { const d = exportFamilyCSV(); if (d) downloadText('persons.csv', d.personsCSV); } },
        icon('download', 18), t('admin.dataDownloadPersons')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => { const d = exportFamilyCSV(); if (d) downloadText('relationships.csv', d.relationshipsCSV); } },
        icon('download', 18), t('admin.dataDownloadRelationships'))),

      h('p', { class: 'small muted data-import-note' }, t('admin.dataImportNote')),
      h('div', { class: 'file-row' },
        h('label', { for: 'data-persons', class: 'small' }, t('admin.dataPersonsFile')),
        h('input', { id: 'data-persons', type: 'file', accept: '.csv,text/csv', onchange: onPick('persons') })),
      h('div', { class: 'file-row' },
        h('label', { for: 'data-rels', class: 'small' }, t('admin.dataRelationshipsFile')),
        h('input', { id: 'data-rels', type: 'file', accept: '.csv,text/csv', onchange: onPick('relationships') })),
      h('div', { class: 'row' }, importBtn),
      errorsBox,
      h('p', { class: 'small muted' }, t('admin.dataSupabaseNote'))));
}

function editCard(r) {
  const p = person(r.target_person_id);
  const own = r.submitted_by === state.meId;
  return h('article', { class: 'card edit-card' },
    h('h3', {}, h('a', { href: `#/person/${p.id}` }, displayName(p))),
    h('p', { class: 'small muted' }, t('admin.by', { name: displayName(person(r.submitted_by)), date: formatDate(r.created_at) })),
    h('dl', { class: 'dl diff' }, Object.entries(r.proposed_changes).filter(([k, v]) => (p[k] ?? null) !== v).map(([k, v]) => h('div', { class: 'dl-row' },
      h('dt', {}, t(`field.${k}`)),
      h('dd', {}, p[k] != null ? h('del', {}, String(p[k])) : null, p[k] != null ? ' → ' : null, h('ins', {}, String(v ?? '—')))))),
    own
      ? h('p', { class: 'small muted' }, t('admin.ownSuggestion'))
      : h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => reviewEdit(r.id, false) }, t('admin.reject')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => reviewEdit(r.id, true) }, t('admin.approve'))));
}

import { h, toast } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { state, person, graph, relationTo, canEdit, contactView, updatePerson, suggestEdit, setMyPhone } from '../data/store.js';
import { isKnownMinor } from '../lib/graph.js';
import { displayName, years, avatar, personChip } from '../ui/people.js';
import { relLabel, relLabelOther } from './relation.js';
import { openPersonMenu } from '../ui/person-menu.js';

const EDITABLE = ['full_name', 'known_as', 'house_name', 'birth_year', 'death_year', 'native_place', 'city', 'notes'];

export function personView(id, params) {
  const p = person(id);
  if (!p) return h('main', { class: 'page' }, h('p', { class: 'card muted' }, t('person.notFound')));
  const g = graph();
  const r = relationTo(id);
  const editing = params.get('edit');
  const mode = canEdit(id) ? 'edit' : 'suggest';

  const status = p.is_living === false ? t('person.deceased') : p.is_living ? t('person.living') : t('person.livingUnknown');
  const detail = (key, value) => (value ? h('div', { class: 'dl-row' }, h('dt', {}, t(`field.${key}`)), h('dd', {}, value)) : null);
  const group = (title, people) => (people.length
    ? h('div', { class: 'family-group' }, h('h3', {}, title), h('div', { class: 'chips' }, people)) : null);

  return h('main', { class: 'page' },
    h('header', { class: 'profile-head' },
      avatar(p, 'lg'),
      h('div', {},
        h('h1', { class: p.name_known ? '' : 'is-unknown' },
          p.is_living === false && p.name_known ? h('span', { class: 'late' }, `${t('common.late')} `) : null, displayName(p)),
        p.house_name ? h('p', { class: 'house' }, p.house_name) : null,
        h('p', { class: 'muted' }, [years(p), status].filter(Boolean).join(' · ')))),

    r.kind !== 'self' && r.kind !== 'none' ? h('section', { class: 'card relation-card' },
      h('p', { class: 'eyebrow' }, t('person.relation')),
      h('p', { class: 'result-label' }, relLabel(r)),
      h('p', { class: 'result-other' }, relLabelOther(r)),
      r.taLocalDraft ? h('p', { class: 'small muted' }, t('person.localDraft', { term: r.taLocalDraft })) : null,
      h('a', { class: 'link', href: `#/relation?from=${state.meId}&to=${id}` }, t('person.howRelated'))) : null,

    h('section', { class: 'card' },
      h('h2', {}, t('person.details')),
      h('dl', { class: 'dl' },
        detail('known_as', p.known_as), detail('native_place', p.native_place), detail('city', p.city), detail('notes', p.notes)),
      phoneBlock(id)),

    h('section', { class: 'card' },
      h('h2', {}, t('person.family')),
      group(t('person.parents'), g.parentsOf(id).map((x) => personChip(person(x.id)))),
      group(t('person.spouses'), g.spousesOf(id).map((x) => personChip(person(x.id),
        x.status !== 'married' ? t(`person.${x.status}`) : null))),
      group(t('person.children'), g.childrenOf(id).map((x) => person(x.id))
        .sort((a, b) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999)).map((c) => personChip(c, years(c)))),
      group(t('person.siblings'), g.siblingsOf(id).map((x) => personChip(person(x), years(person(x)))))),

    editing ? editForm(p, mode) : h('div', { class: 'actions' },
      h('a', { class: `btn ${mode === 'edit' ? 'btn-primary' : 'btn-ghost'}`, href: `#/person/${id}?edit=1` },
        t(mode === 'edit' ? 'person.edit' : 'person.suggest')),
      canEdit(id) ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openPersonMenu(id) }, t('person.addFamily')) : null,
      mode === 'suggest' && isKnownMinor(p) ? h('p', { class: 'small muted' }, t('person.minorNote')) : null));
}

function phoneFields(c) {
  return h('div', {},
    h('label', { for: 'f-phone' }, t('person.phone')),
    h('input', { id: 'f-phone', name: 'phone', type: 'tel', value: c.phone ?? '', placeholder: '+91XXXXXXXXXX' }),
    h('p', { class: 'small muted' }, t('join.phoneInvalid')),
    h('label', { class: 'checkbox-row' },
      h('input', { type: 'checkbox', name: 'phone_hidden', checked: !!c.hidden }), t('phone.selfHidden')));
}

function phoneBlock(id) {
  const c = contactView(id);
  let body;
  if (c.kind === 'self') body = c.hidden ? t('phone.selfHidden') : `${t('phone.self')}: ${c.phone}`;
  else if (c.kind === 'visible') {
    body = h('span', { class: 'phone' }, h('span', { class: 'mono' }, c.phone),
      h('a', { class: 'link', href: `https://wa.me/${c.phone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener' }, t('phone.whatsapp')));
  } else if (c.kind === 'ask') {
    body = c.askId
      ? h('a', { class: 'link', href: `#/person/${c.askId}` }, t('phone.ask', { name: person(c.askId).full_name }))
      : t('phone.notShared');
  } else body = t('phone.none');
  return h('div', { class: 'phone-block' },
    h('dl', { class: 'dl' }, h('div', { class: 'dl-row' }, h('dt', {}, t('person.phone')), h('dd', {}, body))),
    h('p', { class: 'small muted' }, t('phone.rule')));
}

function editForm(p, mode) {
  const isSelf = mode === 'edit' && p.id === state.meId;
  const c = isSelf ? contactView(p.id) : null;
  const submit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const changes = {};
    for (const key of EDITABLE) {
      if (!data.has(key)) continue;
      let v = String(data.get(key)).trim();
      v = v === '' ? null : ['birth_year', 'death_year'].includes(key) ? Number(v) : v;
      if (v !== (p[key] ?? null)) changes[key] = v;
    }
    if (changes.full_name !== undefined) changes.name_known = !!changes.full_name;
    const statusRaw = data.get('is_living');
    if (statusRaw !== null) {
      const v = statusRaw === '' ? null : statusRaw === 'true';
      if (v !== (p.is_living ?? null)) changes.is_living = v;
    }
    // Entering a death year always implies deceased, even if the status field above wasn't touched.
    if (changes.death_year) changes.is_living = false;
    const phoneChange = isSelf && data.has('phone')
      ? { phone: String(data.get('phone')).trim(), hidden: data.get('phone_hidden') === 'on' }
      : null;
    if (!Object.keys(changes).length && !phoneChange) { location.hash = `#/person/${p.id}`; return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (Object.keys(changes).length) {
        if (mode === 'edit') await updatePerson(p.id, changes);
        else await suggestEdit(p.id, changes);
      }
      if (phoneChange && (phoneChange.phone !== (c.phone ?? '') || phoneChange.hidden !== !!c.hidden)) {
        await setMyPhone(phoneChange.phone, phoneChange.hidden);
      }
      toast(t(mode === 'edit' ? 'person.saved' : 'person.sent'));
      location.hash = `#/person/${p.id}`;
    } catch (err) {
      btn.disabled = false;
      toast(err.message ?? t('common.error'));
    }
  };
  const field = (key, type = 'text') => [
    h('label', { for: `f-${key}` }, t(`field.${key}`)),
    key === 'notes'
      ? h('textarea', { id: `f-${key}`, name: key, rows: '3' }, p[key] ?? '')
      : h('input', { id: `f-${key}`, name: key, type, value: p[key] ?? '', inputmode: type === 'number' ? 'numeric' : null }),
  ];
  return h('form', { class: 'card form', onsubmit: submit },
    h('h2', {}, t(mode === 'edit' ? 'person.edit' : 'person.suggest')),
    mode === 'suggest' ? h('p', { class: 'small muted' }, t('person.suggestNote')) : null,
    field('full_name'), field('known_as'), field('house_name'),
    field('birth_year', 'number'), field('death_year', 'number'),
    h('label', { for: 'f-is_living' }, t('person.status')),
    h('select', { id: 'f-is_living', name: 'is_living' },
      h('option', { value: '', selected: p.is_living == null }, t('person.livingUnknown')),
      h('option', { value: 'true', selected: p.is_living === true }, t('person.living')),
      h('option', { value: 'false', selected: p.is_living === false }, t('person.deceased'))),
    h('p', { class: 'small muted' }, t('person.deceasedYearNote')),
    field('native_place'), field('city'), field('notes'),
    isSelf ? phoneFields(c) : null,
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-ghost', href: `#/person/${p.id}` }, t('common.cancel')),
      h('button', { class: 'btn btn-primary', type: 'submit' }, t(mode === 'edit' ? 'common.save' : 'person.suggest'))));
}

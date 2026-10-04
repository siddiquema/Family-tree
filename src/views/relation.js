import { h } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { state, person, graph, relationTo } from '../data/store.js';
import { findPath, toSteps, describe } from '../lib/kinship.js';
import { displayName, avatar } from '../ui/people.js';

/** The label in the interface language. */
export function relLabel(r) {
  if (r.kind === 'self') return t('common.you');
  if (r.kind === 'none') return '';
  return state.lang === 'ta' ? r.ta : r.en;
}
/** The same label in the other language, shown underneath. */
export function relLabelOther(r) {
  if (r.kind !== 'term' && r.kind !== 'described') return '';
  return state.lang === 'ta' ? r.en : r.ta;
}

const sorted = () => [...state.persons].sort((a, b) =>
  (a.name_known ? a.full_name : '~').localeCompare(b.name_known ? b.full_name : '~'));

export function relationView(params) {
  const from = params.get('from') ?? state.meId;
  const to = params.get('to');
  const go = (f, tt) => { location.hash = `#/relation?from=${f}${tt ? `&to=${tt}` : ''}`; };

  const select = (id, value, onChange, placeholder) => h('select', { id, onchange: (e) => onChange(e.target.value) },
    placeholder ? h('option', { value: '' }, placeholder) : null,
    sorted().map((p) => h('option', { value: p.id, selected: p.id === value }, displayName(p))));

  return h('main', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', {}, t('relation.title'))),
    h('div', { class: 'card form' },
      h('label', { for: 'rel-from' }, t('relation.from')),
      select('rel-from', from, (v) => go(v, to)),
      h('label', { for: 'rel-to' }, t('relation.to')),
      select('rel-to', to, (v) => go(from, v), t('relation.choose'))),
    to && person(to) ? result(from, to) : null);
}

function result(from, to) {
  const r = relationTo(to, from);
  if (r.kind === 'self') return h('p', { class: 'card muted' }, t('relation.self'));
  if (r.kind === 'none') return h('p', { class: 'card muted' }, t('relation.none'));

  const ids = findPath(graph(), from, to);
  const steps = toSteps(graph(), ids);
  return h('section', { class: 'card result' },
    h('p', { class: 'result-label' }, relLabel(r)),
    h('p', { class: 'result-other' }, relLabelOther(r)),
    r.taLocalDraft ? h('p', { class: 'small muted' }, t('person.localDraft', { term: r.taLocalDraft })) : null,
    h('p', { class: 'small muted' },
      [r.side !== 'none' ? t(`relation.${r.side}`) : null, t('relation.steps', { n: r.steps })].filter(Boolean).join(' · ')),
    r.kind === 'described' ? h('p', { class: 'note' }, t('relation.described')) : null,
    h('h3', {}, t('relation.link')),
    h('ol', { class: 'path' },
      h('li', {}, avatar(person(from), 'sm'), h('span', {}, displayName(person(from)))),
      steps.map((s) => {
        const label = describe([s]);
        return h('li', {}, avatar(person(s.id), 'sm'),
          h('a', { href: `#/person/${s.id}` }, displayName(person(s.id))),
          h('span', { class: 'path-step' }, state.lang === 'ta' ? label.ta : label.en.toLowerCase()));
      })));
}

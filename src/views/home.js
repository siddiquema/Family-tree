import { h, icon } from '../ui/dom.js';
import { t, formatDate } from '../i18n/index.js';
import { state, me, person, graph, nudges, isAdmin, relationTo } from '../data/store.js';
import { personChip } from '../ui/people.js';
import { relLabel } from './relation.js';

export function homeView() {
  const self = me();
  const g = graph();
  const close = [
    ...g.parentsOf(self.id).map((x) => x.id),
    ...g.spousesOf(self.id).filter((x) => x.status === 'married').map((x) => x.id),
    ...g.siblingsOf(self.id),
    ...g.childrenOf(self.id).map((x) => x.id),
  ].map(person);
  const pending = state.editRequests.filter((r) => r.status === 'pending').length;
  const latest = state.announcements[0];
  const items = nudges();

  return h('main', { class: 'page' },
    h('header', { class: 'page-head' },
      h('h1', {}, t('home.greeting', { name: self.full_name })),
      h('p', { class: 'muted' }, t('home.stats', { people: state.persons.length, joined: state.members.length }))),

    isAdmin() && pending > 0
      ? h('a', { class: 'banner', href: '#/admin' }, icon('admin', 20), t('home.approvals', { n: pending })) : null,

    h('section', { class: 'card' },
      h('h2', {}, t('home.nudges')),
      items.length
        ? h('ul', { class: 'nudges' }, items.map((n) => {
          const p = person(n.id);
          return h('li', {}, h('a', { href: `#/person/${p.id}` },
            h('span', {}, n.kind === 'name' ? t('nudge.name') : t(`nudge.${n.kind}`, { name: p.full_name })),
            h('span', { class: 'nudge-rel' }, relLabel(relationTo(p.id)))));
        }))
        : h('p', { class: 'muted' }, t('home.nudgesDone'))),

    h('section', {},
      h('h2', { class: 'section-title' }, t('home.close')),
      h('div', { class: 'chips' }, close.map((p) => personChip(p, relLabel(relationTo(p.id)))))),

    latest ? h('section', {},
      h('h2', { class: 'section-title' }, t('home.latest')),
      h('a', { class: 'card news-card', href: '#/news' },
        h('span', { class: `tag tag-${latest.type}` }, t(`type.${latest.type}`)),
        h('h3', {}, latest.title),
        h('p', { class: 'muted small' }, latest.event_date ? t('news.on', { date: formatDate(latest.event_date) }) : formatDate(latest.sent_at)))) : null,

    h('a', { class: 'btn btn-primary btn-block', href: '#/tree' }, icon('tree', 20), t('home.openTree')));
}

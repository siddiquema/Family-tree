import { h, toast } from '../ui/dom.js';
import { t, formatDate } from '../i18n/index.js';
import { state, person, isAdmin, member, recipients, addAnnouncement } from '../data/store.js';
import { displayName } from '../ui/people.js';

const TYPES = ['marriage', 'birth', 'event', 'demise', 'general'];

export function newsView(params) {
  const composing = params.get('new');
  return h('main', { class: 'page' },
    h('header', { class: 'page-head row-between' },
      h('h1', {}, t('news.title')),
      composing ? null : h('a', { class: 'btn btn-primary btn-sm', href: '#/news?new=1' }, t('news.new'))),
    composing ? compose() : null,
    !state.announcements.length && !composing ? h('p', { class: 'card muted' }, t('news.empty')) : null,
    state.announcements.map((a) => {
      const shareText = `${a.title}\n${a.body ?? ''}`.trim();
      return h('article', { class: 'card news-item' },
        h('div', { class: 'row-between' },
          h('span', { class: `tag tag-${a.type}` }, t(`type.${a.type}`)),
          h('span', { class: 'small muted' }, formatDate(a.sent_at))),
        h('h2', {}, a.title),
        a.event_date ? h('p', { class: 'small' }, t('news.on', { date: formatDate(a.event_date) })) : null,
        a.body ? h('p', {}, a.body) : null,
        h('div', { class: 'row-between' },
          h('span', { class: 'small muted' },
            [t('news.from', { name: displayName(person(a.created_by)) }), a.audience === 'all' ? t('audience.all') : t('audience.selected')].join(' · ')),
          h('a', { class: 'link', href: `https://wa.me/?text=${encodeURIComponent(shareText)}`, target: '_blank', rel: 'noopener' }, t('news.share'))));
    }));
}

function compose() {
  const form = h('form', { class: 'card form', onsubmit: async (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await addAnnouncement({
        type: d.get('type'), title: String(d.get('title')).trim(), body: String(d.get('body')).trim(),
        event_date: d.get('event_date') || null, audience: d.get('audience') === 'all' ? 'all' : 'selected',
      });
      toast(t('news.sent'));
      location.hash = '#/news';
    } catch (err) {
      btn.disabled = false;
      toast(err.message ?? t('common.error'));
    }
  } });
  const preview = h('p', { class: 'note', 'aria-live': 'polite' });
  const anchorWrap = h('div', { class: 'stack', hidden: true });
  const update = () => {
    const d = new FormData(form);
    const audience = d.get('audience');
    anchorWrap.hidden = audience === 'all';
    const r = recipients(audience, d.get('anchor'));
    preview.textContent = [t('news.preview', { count: r.count }), r.sms ? t('news.previewSms', { sms: r.sms }) : '',
      d.get('type') === 'demise' ? t('news.demiseNote') : ''].filter(Boolean).join(' ');
  };
  const people = [...state.persons].filter((p) => p.name_known).sort((a, b) => a.full_name.localeCompare(b.full_name));

  form.append(
    h('label', { for: 'n-type' }, t('news.type')),
    h('select', { id: 'n-type', name: 'type', onchange: update }, TYPES.map((x) => h('option', { value: x }, t(`type.${x}`)))),
    h('label', { for: 'n-title' }, t('news.titleField')),
    h('input', { id: 'n-title', name: 'title', required: true, maxlength: '120' }),
    h('label', { for: 'n-body' }, t('news.message')),
    h('textarea', { id: 'n-body', name: 'body', rows: '4' }),
    h('label', { for: 'n-date' }, t('news.date')),
    h('input', { id: 'n-date', name: 'event_date', type: 'date' }),
    h('label', { for: 'n-audience' }, t('news.audience')),
    h('select', { id: 'n-audience', name: 'audience', onchange: update },
      h('option', { value: 'all' }, t('audience.all')),
      h('option', { value: 'branch' }, t('audience.branch')),
      h('option', { value: 'immediate' }, t('audience.immediate'))),
    anchorWrap,
    preview,
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-ghost', href: '#/news' }, t('common.cancel')),
      h('button', { class: 'btn btn-primary', type: 'submit' }, t('news.send'))));
  anchorWrap.append(
    h('label', { for: 'n-anchor' }, t('news.anchor')),
    h('select', { id: 'n-anchor', name: 'anchor', onchange: update },
      people.map((p) => h('option', { value: p.id, selected: p.id === state.meId }, displayName(p)))));
  queueMicrotask(update);
  return form;
}

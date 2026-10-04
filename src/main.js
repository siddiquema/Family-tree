import './styles.css';
import { h, icon } from './ui/dom.js';
import { t } from './i18n/index.js';
import { state, subscribe, setLang, isAdmin, viewAs, person } from './data/store.js';
import { loginView } from './views/login.js';
import { homeView } from './views/home.js';
import { treeView } from './views/tree.js';
import { personView } from './views/person.js';
import { relationView } from './views/relation.js';
import { newsView } from './views/news.js';
import { adminView } from './views/admin.js';

const root = document.getElementById('app');

// Members who have joined; with only one (the real family so far), any living named person,
// so the prototype can still show what a relative would see.
function viewAsOptions() {
  if (state.members.length > 1) return state.members.map((m) => [m.person_id, `${person(m.person_id).full_name} · ${t(`role.${m.role}`)}`]);
  return state.persons.filter((p) => p.name_known && p.is_living !== false)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((p) => [p.id, p.id === state.members[0]?.person_id ? `${p.full_name} · ${t('role.admin')}` : p.full_name]);
}

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: (path || '/').split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function route() {
  const { parts, params } = parseHash();
  if (!state.signedIn) return { tab: null, view: loginView() };
  switch (parts[0]) {
    case 'tree': return { tab: 'tree', view: treeView(params) };
    case 'person': return { tab: null, view: personView(parts[1], params) };
    case 'relation': return { tab: 'relation', view: relationView(params) };
    case 'news': return { tab: 'news', view: newsView(params) };
    case 'admin': return { tab: 'admin', view: adminView() };
    default: return { tab: 'home', view: homeView() };
  }
}

function render() {
  document.documentElement.lang = state.lang;
  const { tab, view } = route();
  const tabs = [['home', '#/'], ['tree', '#/tree'], ['relation', '#/relation'], ['news', '#/news'], ...(isAdmin() ? [['admin', '#/admin']] : [])];
  const scroll = view.classList.contains('tree-page') ? 0 : window.scrollY;

  root.replaceChildren(
    h('div', { class: 'proto-banner' }, h('span', {}, t(state.source === 'seed' ? 'app.prototypeFamily' : 'app.prototype')),
      state.signedIn ? h('label', { class: 'view-as' }, t('app.viewAs'), ' ',
        h('select', { id: 'view-as', onchange: (e) => { viewAs(e.target.value); location.hash = '#/'; } },
          viewAsOptions().map(([id, label]) => h('option', { value: id, selected: id === state.meId }, label)))) : null),
    h('header', { class: 'topbar' },
      parseHash().parts[0] === 'person'
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => history.back() }, icon('back'))
        : h('span', { class: 'brand' }, t('app.name')),
      h('button', { class: 'lang-btn', type: 'button', onclick: () => setLang(state.lang === 'en' ? 'ta' : 'en') }, t('lang.switch'))),
    view,
    state.signedIn ? h('nav', { class: 'tabbar', 'aria-label': t('app.name') },
      tabs.map(([name, href]) => h('a', { href, class: name === tab ? 'is-active' : '', 'aria-current': name === tab ? 'page' : null },
        icon(name), h('span', {}, t(`nav.${name}`))))) : null);
  window.scrollTo(0, scroll);
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const samePage = lastHash.split('?')[0] === location.hash.split('?')[0];
  lastHash = location.hash;
  render();
  if (!samePage) window.scrollTo(0, 0);
});
subscribe(render);
render();

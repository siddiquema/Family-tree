import './styles.css';
import { h, icon } from './ui/dom.js';
import { t } from './i18n/index.js';
import { state, subscribe, setLang, isAdmin, resumeSession } from './data/store.js';
import { loginView } from './views/login.js';
import { homeView } from './views/home.js';
import { treeView } from './views/tree.js';
import { personView } from './views/person.js';
import { relationView } from './views/relation.js';
import { newsView } from './views/news.js';
import { adminView } from './views/admin.js';

const root = document.getElementById('app');

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: (path || '/').split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function route() {
  const { parts, params } = parseHash();
  if (!state.signedIn) return { tab: null, view: loginView() };
  if (!state.ready) return { tab: null, view: h('main', { class: 'page' }, h('p', { class: 'muted' }, t('app.loading'))) };
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
    h('header', { class: 'topbar' },
      parseHash().parts[0] === 'person'
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => history.back() }, icon('back'))
        : h('span', { class: 'brand' }, t('app.name')),
      h('button', { class: 'lang-btn', type: 'button', onclick: () => setLang(state.lang === 'en' ? 'ta' : 'en') }, t('lang.switch'))),
    view,
    state.ready ? h('nav', { class: 'tabbar', 'aria-label': t('app.name') },
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
resumeSession();

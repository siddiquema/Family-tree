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
import { joinView } from './views/join.js';

const root = document.getElementById('app');

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: (path || '/').split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function route() {
  const { parts, params } = parseHash();
  if (parts[0] === 'join' && !state.signedIn) return { tab: null, view: joinView(params) };
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

/** A bug in any one view (a bad date, a missing field) used to crash this whole function —
 *  since it runs synchronously inside the data-loading chain, that left the page frozen on
 *  whatever it showed before (usually "Loading your family…") with no visible error at all,
 *  recoverable only by digging through the browser console. Catch it here once instead, so a
 *  future bug like that is at least visible and recoverable with a reload. */
function render() {
  try {
    renderUnsafe();
  } catch (err) {
    console.error(err);
    root.replaceChildren(h('main', { class: 'page' },
      h('p', { class: 'card muted' }, 'Something went wrong showing this page.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reload')));
  }
}

function renderUnsafe() {
  document.documentElement.lang = state.lang;
  const { tab, view } = route();
  const tabs = [['home', '#/'], ['tree', '#/tree'], ['relation', '#/relation'], ['news', '#/news'], ...(isAdmin() ? [['admin', '#/admin']] : [])];
  const scroll = view.classList.contains('tree-page') ? 0 : window.scrollY;

  // replaceChildren() stringifies any non-Node argument — a bare `null` for "no nav yet" was
  // rendering as a literal "null" text node on screen; filter falsy children out instead.
  root.replaceChildren(...[
    h('header', { class: 'topbar' },
      parseHash().parts[0] === 'person'
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => history.back() }, icon('back'))
        : h('span', { class: 'brand' }, t('app.name')),
      h('button', { class: 'lang-btn', type: 'button', onclick: () => setLang(state.lang === 'en' ? 'ta' : 'en') }, t('lang.switch'))),
    view,
    state.ready ? h('nav', { class: 'tabbar', 'aria-label': t('app.name') },
      tabs.map(([name, href]) => h('a', { href, class: name === tab ? 'is-active' : '', 'aria-current': name === tab ? 'page' : null },
        icon(name), h('span', {}, t(`nav.${name}`))))) : null,
  ].filter(Boolean));
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

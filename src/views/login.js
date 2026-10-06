import { h, toast } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { state, signInWithPassword } from '../data/store.js';

export function loginView() {
  const submit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const id = String(data.get('id') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!id || !password) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const ok = await signInWithPassword(id, password);
    btn.disabled = false;
    if (!ok) toast(state.authError ?? t('login.failed'));
  };
  return h('main', { class: 'login' },
    h('div', { class: 'login-mark', 'aria-hidden': 'true' }, treeMark()),
    h('h1', { class: 'login-title' }, t('app.name')),
    h('p', { class: 'muted' }, t('login.invite')),
    h('form', { class: 'card form', onsubmit: submit },
      h('label', { for: 'login-id' }, t('login.id')),
      h('input', { id: 'login-id', name: 'id', autocomplete: 'username', inputmode: 'email', required: true, placeholder: '+91 … / name@example.com' }),
      h('label', { for: 'login-password' }, t('login.password')),
      h('input', { id: 'login-password', name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, t('login.submit'))),
    h('p', { class: 'small muted' }, t('login.forgot')));
}

function treeMark() {
  const box = document.createElement('div');
  box.innerHTML = '<svg viewBox="0 0 64 64" width="56" height="56"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M32 58V30M32 40 20 30M32 36l12-10M20 30V20M44 26V16"/><circle cx="32" cy="22" r="6"/><circle cx="20" cy="14" r="5"/><circle cx="44" cy="11" r="5"/></g></svg>';
  return box.firstChild;
}

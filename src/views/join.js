// Redeeming an invite link (§5a), reachable without being signed in.
//
// TEMPORARY (08 Oct 26): neither email nor phone is verified right now — see the note on
// joinSimple() in src/data/store.js for why (Supabase's built-in email sender is too
// rate-limited for real use, and a real SMTP provider isn't configured yet). The real
// email-OTP flow (emailStep/codeStep below) is kept working but unused; switch joinView back
// to it once SMTP is sorted.
import { h, toast } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { state, startJoin, joinSendCode, joinVerifyCode, joinFinish, joinSimple } from '../data/store.js';

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

export function joinView(params) {
  const token = params.get('token');
  if (!token) return h('main', { class: 'login' }, h('p', { class: 'card muted' }, t('join.noToken')));
  startJoin(token);
  const j = state.join;
  return h('main', { class: 'login' },
    h('h1', { class: 'login-title' }, t('join.title')),
    j.step === 'email' ? emailStep(j) : j.step === 'code' ? codeStep(j) : detailsStep(j));
}

/** Unused while joinView defaults to the 'details' step — see the file header. */
function emailStep(j) {
  const submit = async (e) => {
    e.preventDefault();
    const email = String(new FormData(e.target).get('email') ?? '').trim();
    if (!email) return;
    await joinSendCode(email);
  };
  return [
    h('p', { class: 'muted' }, t('join.emailIntro')),
    h('form', { class: 'card form', onsubmit: submit },
      h('label', { for: 'join-email' }, t('join.email')),
      h('input', { id: 'join-email', name: 'email', type: 'email', required: true, disabled: j.busy, autofocus: true }),
      j.error ? h('p', { class: 'small', style: 'color:var(--danger)' }, j.error) : null,
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: j.busy }, t('join.sendCode'))),
  ];
}

/** Unused while joinView defaults to the 'details' step — see the file header. */
function codeStep(j) {
  const submit = async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code') ?? '').trim();
    if (!code) return;
    await joinVerifyCode(code);
  };
  return [
    h('p', { class: 'muted' }, t('join.codeIntro', { email: j.email })),
    h('form', { class: 'card form', onsubmit: submit },
      h('label', { for: 'join-code' }, t('join.code')),
      h('input', { id: 'join-code', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', required: true, disabled: j.busy, autofocus: true }),
      j.error ? h('p', { class: 'small', style: 'color:var(--danger)' }, j.error) : null,
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: j.busy }, t('join.verifyCode'))),
  ];
}

function detailsStep(j) {
  const submit = async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const email = String(d.get('email') ?? '').trim();
    const phone = String(d.get('phone') ?? '').trim();
    const password = String(d.get('password') ?? '');
    if (!email) return;
    if (phone && !PHONE_RE.test(phone)) { toast(t('join.phoneInvalid')); return; }
    if (password.length < 12) { toast(t('join.passwordTooShort')); return; }
    await joinSimple({ email, phone: phone || null, password });
  };
  return [
    h('p', { class: 'muted' }, t('join.detailsIntroNoOtp')),
    h('form', { class: 'card form', onsubmit: submit },
      h('label', { for: 'join-email' }, t('join.email')),
      h('input', { id: 'join-email', name: 'email', type: 'email', required: true, disabled: j.busy, autofocus: true }),
      h('label', { for: 'join-phone' }, t('join.phone')),
      h('input', { id: 'join-phone', name: 'phone', type: 'tel', placeholder: '+91XXXXXXXXXX', disabled: j.busy }),
      h('p', { class: 'small muted' }, t('join.phoneNote')),
      h('label', { for: 'join-password' }, t('join.password')),
      h('input', { id: 'join-password', name: 'password', type: 'password', autocomplete: 'new-password', minlength: '12', required: true, disabled: j.busy }),
      j.error ? h('p', { class: 'small', style: 'color:var(--danger)' }, j.error) : null,
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: j.busy }, t('join.finish'))),
  ];
}

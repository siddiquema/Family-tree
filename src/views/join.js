// Redeeming an invite link (§5a), reachable without being signed in. Email is verified for
// real via Supabase's own OTP. Phone is collected but NOT verified yet — see the note on
// joinFinish() in src/data/store.js for why, and supabase/migrations/…_invite_redemption.sql
// for how that gap is kept visible in the data.
import { h, toast } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { state, startJoin, joinSendCode, joinVerifyCode, joinFinish } from '../data/store.js';

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
    const phone = String(d.get('phone') ?? '').trim();
    const password = String(d.get('password') ?? '');
    if (phone && !PHONE_RE.test(phone)) { toast(t('join.phoneInvalid')); return; }
    if (password.length < 12) { toast(t('join.passwordTooShort')); return; }
    await joinFinish({ phone: phone || null, password });
  };
  return [
    h('p', { class: 'muted' }, t('join.detailsIntro')),
    h('form', { class: 'card form', onsubmit: submit },
      h('label', { for: 'join-phone' }, t('join.phone')),
      h('input', { id: 'join-phone', name: 'phone', type: 'tel', placeholder: '+91XXXXXXXXXX', disabled: j.busy }),
      h('p', { class: 'small muted' }, t('join.phoneNote')),
      h('label', { for: 'join-password' }, t('join.password')),
      h('input', { id: 'join-password', name: 'password', type: 'password', autocomplete: 'new-password', minlength: '12', required: true, disabled: j.busy }),
      j.error ? h('p', { class: 'small', style: 'color:var(--danger)' }, j.error) : null,
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: j.busy }, t('join.finish'))),
  ];
}

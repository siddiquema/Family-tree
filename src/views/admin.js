import { h, icon, toast } from '../ui/dom.js';
import { openActionSheet } from '../ui/actionsheet.js';
import { t, formatDate } from '../i18n/index.js';
import {
  state, person, reviewEdit, setVerified, signOut, isAdmin, exportFamilyCSV, importFamilyCSV,
  unclaimedPersons, createInvite, revokeInvite, dismissNewInviteLink, adminLinkMember,
  mfaEnrollStart, mfaEnrollConfirm, adminResetPassword, dismissPasswordReset,
} from '../data/store.js';
import { displayName } from '../ui/people.js';
import { downloadText } from '../ui/download.js';

export function adminView() {
  if (!isAdmin()) return h('main', { class: 'page' }, h('p', { class: 'card muted' }, t('admin.noneWaiting')));
  const pending = state.editRequests.filter((r) => r.status === 'pending');
  const done = state.editRequests.filter((r) => r.status !== 'pending').slice(0, 3);
  const missing = [...state.missing.entries()].sort((a, b) => b[1] - a[1]);

  return h('main', { class: 'page' },
    h('header', { class: 'page-head row-between' },
      h('h1', {}, t('admin.title')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { signOut(); location.hash = '#/'; } }, t('admin.signOut'))),

    securitySection(),
    invitesSection(),
    stuckLoginsSection(),
    dataSection(),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.approvals')),
      pending.length ? pending.map((r) => editCard(r)) : h('p', { class: 'card muted' }, t('admin.noneWaiting')),
      done.map((r) => h('p', { class: 'small muted done-line' },
        `${displayName(person(r.target_person_id))}: ${t(r.status === 'approved' ? 'admin.approved' : 'admin.rejected')}`))),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.terms')),
      h('p', { class: 'small muted' }, t('admin.termsNote')),
      termsList()),

    h('section', {},
      h('h2', { class: 'section-title' }, t('admin.missing')),
      missing.length
        ? h('ul', { class: 'card plain-list' }, missing.map(([path, n]) => h('li', {}, h('code', {}, path), ' ', h('span', { class: 'small muted' }, t('admin.lookups', { n })))))
        : h('p', { class: 'small muted' }, t('admin.missingNone'))),

    membersSection());
}

/** Member list, plus the temporary admin-set-password tool (§5a note in the migration): the
 *  real recovery flow needs a second, different admin to approve, which doesn't exist while
 *  Siddique is the only admin. */
function membersSection() {
  return h('section', {},
    h('h2', { class: 'section-title' }, t('admin.members')),
    state.passwordReset ? resetResultCard(state.passwordReset) : null,
    h('ul', { class: 'card plain-list' }, state.members.map((m) => {
      const name = displayName(person(m.person_id));
      const run = async () => {
        btn.disabled = true;
        try { await adminResetPassword(m.user_id, name); }
        catch (err) { toast(err.message ?? t('common.error')); }
        finally { btn.disabled = false; }
      };
      const btn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('admin.resetPassword'));
      btn.onclick = () => openActionSheet({
        title: t('admin.resetPasswordConfirmTitle', { name }),
        subtitle: t('admin.resetPasswordConfirm'),
        items: [{ icon: 'edit', label: t('admin.resetPassword'), danger: true, onSelect: run }],
        cancelLabel: t('common.cancel'),
      });
      return h('li', { class: 'row-between' },
        h('a', { href: `#/person/${m.person_id}` }, name),
        h('span', { class: 'row', style: 'justify-content:flex-end' },
          h('span', { class: 'small muted' }, t(`role.${m.role}`)),
          btn));
    })));
}

function resetResultCard(r) {
  return h('div', { class: 'note' },
    h('p', { class: 'small' }, t('admin.resetPasswordReady', { name: r.name })),
    h('p', { class: 'mono small', style: 'overflow-wrap:anywhere' }, r.password),
    h('p', { class: 'small muted' }, t('admin.resetPasswordNote')),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(r.password); toast(t('admin.invitesCopied')); } catch { toast(r.password); }
      } }, t('admin.invitesCopy')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: dismissPasswordReset }, t('common.cancel'))));
}

/** Family-data export (CSV, for Excel) and import. Admin only (adminView already gates the page). */
function dataSection() {
  const picked = { persons: null, relationships: null };
  const errorsBox = h('ul', { class: 'small import-errors', hidden: true });
  const importBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, t('admin.dataImportAction'));

  const refreshReady = () => { importBtn.disabled = !(picked.persons && picked.relationships); };
  const onPick = (key) => async (e) => {
    const file = e.target.files[0];
    picked[key] = file ? await file.text() : null;
    refreshReady();
  };
  importBtn.onclick = () => {
    const result = importFamilyCSV(picked.persons, picked.relationships);
    if (!result.ok) {
      errorsBox.hidden = false;
      errorsBox.replaceChildren(...result.errors.slice(0, 20).map((msg) => h('li', {}, msg)),
        result.errors.length > 20 ? h('li', { class: 'muted' }, t('admin.dataMoreErrors', { n: result.errors.length - 20 })) : null);
      return;
    }
    errorsBox.hidden = true;
    errorsBox.replaceChildren();
    toast(t('admin.dataImported', { people: result.people, relationships: result.relationships }));
  };

  return h('section', {},
    h('h2', { class: 'section-title' }, t('admin.dataTitle')),
    h('div', { class: 'card' },
      h('p', { class: 'small muted' }, t('admin.dataExportNote')),
      h('div', { class: 'row', style: 'justify-content:flex-start' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => { const d = exportFamilyCSV(); if (d) downloadText('persons.csv', d.personsCSV); } },
        icon('download', 18), t('admin.dataDownloadPersons')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => { const d = exportFamilyCSV(); if (d) downloadText('relationships.csv', d.relationshipsCSV); } },
        icon('download', 18), t('admin.dataDownloadRelationships'))),

      h('p', { class: 'small muted data-import-note' }, t('admin.dataImportNote')),
      h('div', { class: 'file-row' },
        h('label', { for: 'data-persons', class: 'small' }, t('admin.dataPersonsFile')),
        h('input', { id: 'data-persons', type: 'file', accept: '.csv,text/csv', onchange: onPick('persons') })),
      h('div', { class: 'file-row' },
        h('label', { for: 'data-rels', class: 'small' }, t('admin.dataRelationshipsFile')),
        h('input', { id: 'data-rels', type: 'file', accept: '.csv,text/csv', onchange: onPick('relationships') })),
      h('div', { class: 'row' }, importBtn),
      errorsBox,
      h('p', { class: 'small muted' }, t('admin.dataSupabaseNote'))));
}

/** Confirming a term re-fetches everything and rebuilds the whole page (no diffing), which would
 *  otherwise reset this list's scroll to the top on every click — making whatever was below the
 *  fold seem to "disappear" and the next tap land on the wrong row. Carry the scroll position
 *  across that rebuild by reading the outgoing element (still live in the DOM at this point,
 *  since main.js swaps it in only after this function returns) and restoring it once the new one
 *  is attached. */
function termsList() {
  const previousScroll = document.querySelector('.terms')?.scrollTop ?? 0;
  const list = h('div', { class: 'card terms' }, state.terms.map((term) => h('div', { class: 'term' },
    h('code', { class: 'term-path' }, term.path),
    h('div', { class: 'term-labels' },
      h('span', {}, term.label_en),
      h('span', { class: 'muted' }, term.label_ta_formal),
      term.label_ta_local
        ? h('span', { class: term.is_verified ? 'term-local is-verified' : 'term-local' },
          `${term.label_ta_local}${term.label_ta_local_roman ? ` (${term.label_ta_local_roman})` : ''}`)
        : h('span', { class: 'small muted' }, t('admin.noLocal'))),
    term.label_ta_local
      ? h('button', { class: `btn btn-sm ${term.is_verified ? 'btn-ghost' : 'btn-primary'}`, type: 'button',
        onclick: () => setVerified(term.path, !term.is_verified).catch((err) => toast(err.message ?? t('common.error'))) },
      term.is_verified ? t('admin.undo') : t('admin.confirm'))
      : null)));
  requestAnimationFrame(() => { list.scrollTop = previousScroll; });
  return list;
}

/** Full timestamp (not just a date), for invite expiry/use times. */
function formatWhen(iso) {
  return new Intl.DateTimeFormat(state.lang === 'ta' ? 'ta-IN' : 'en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** A phone usually can't autofocus-scan a QR code shown at thumbnail size on a desktop monitor
 *  from arm's length — it's an SVG, so blowing it up loses no sharpness. */
function openQrLightbox(src) {
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'qr-lightbox', onclick: close },
    h('img', { src, alt: t('admin.securityQrAlt') }));
  document.body.append(backdrop);
}

/** Admin powers (invites, delete, kinship confirm, …) are enforced server-side on an aal2
 *  session (§5a) — the database rejects them under a password-only login regardless of what
 *  this screen shows, so enrollment has to happen before any of those actually work. */
function securitySection() {
  const body = state.mfaEnrolled
    ? h('p', { class: 'small muted' }, t('admin.securityEnabled'))
    : enrollBox();
  return h('section', {},
    h('h2', { class: 'section-title' }, t('admin.securityTitle')),
    h('div', { class: 'card' },
      h('p', { class: 'small muted' }, t('admin.securityNote')),
      body));
}

function enrollBox() {
  const box = h('div', { class: 'stack' });
  const startBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('admin.securityEnable'));
  startBtn.onclick = async () => {
    startBtn.disabled = true;
    try {
      const data = await mfaEnrollStart();
      box.replaceChildren(enrollForm(data.id, data.totp.qr_code, data.totp.secret));
    } catch (err) {
      toast(err.message ?? t('common.error'));
      startBtn.disabled = false;
    }
  };
  box.append(startBtn);
  return box;
}

function enrollForm(factorId, qrSrc, secret) {
  const submit = async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code') ?? '').trim();
    if (!code) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await mfaEnrollConfirm(factorId, code);
      toast(t('admin.securityEnabledToast'));
    } catch (err) {
      btn.disabled = false;
      toast(err.message ?? t('common.error'));
    }
  };
  return h('form', { class: 'stack', onsubmit: submit },
    h('p', { class: 'small' }, t('admin.securityScanNote')),
    h('img', { src: qrSrc, alt: t('admin.securityQrAlt'), width: '180', height: '180', class: 'qr-thumb',
      onclick: (e) => { e.preventDefault(); openQrLightbox(qrSrc); } }),
    h('p', { class: 'small muted' }, t('admin.securityTapEnlarge')),
    h('p', { class: 'small mono' }, secret),
    h('label', { for: 'mfa-enroll-code' }, t('admin.securityCodeLabel')),
    h('input', { id: 'mfa-enroll-code', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', required: true, autofocus: true }),
    h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, t('admin.securityConfirm')));
}

/** Invite creation and management (§5a). Admin only (adminView already gates the page). */
function invitesSection() {
  const candidates = unclaimedPersons();
  const picker = h('select', { id: 'invite-person' },
    h('option', { value: '' }, t('admin.invitesNewProfile')),
    candidates.map((p) => h('option', { value: p.id }, p.full_name)));
  const createBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('admin.invitesCreate'));
  createBtn.onclick = async () => {
    createBtn.disabled = true;
    try {
      await createInvite(picker.value || null);
    } catch (err) {
      toast(err.message ?? t('common.error'));
    } finally {
      createBtn.disabled = false;
    }
  };

  const pending = state.invites.filter((i) => !i.used_at && new Date(i.expires_at) > new Date());
  const expired = state.invites.filter((i) => !i.used_at && new Date(i.expires_at) <= new Date());
  const used = state.invites.filter((i) => i.used_at);

  return h('section', {},
    h('h2', { class: 'section-title' }, t('admin.invitesTitle')),
    h('div', { class: 'card' },
      h('p', { class: 'small muted' }, t('admin.invitesNote')),
      h('p', { class: 'small muted' }, t('admin.invitesPhoneNote')),
      state.newInviteLink ? newInviteCard(state.newInviteLink) : null,
      h('label', { for: 'invite-person' }, t('admin.invitesPerson')),
      picker,
      h('div', { class: 'row' }, createBtn)),
    pending.length ? h('div', { class: 'card' },
      h('h3', {}, t('admin.invitesPending')),
      h('ul', { class: 'plain-list' }, pending.map((i) => invitedRow(i)))) : null,
    expired.length ? h('div', { class: 'card' },
      h('h3', {}, t('admin.invitesExpired')),
      h('ul', { class: 'plain-list' }, expired.map((i) => invitedRow(i)))) : null,
    used.length ? h('div', { class: 'card' },
      h('h3', {}, t('admin.invitesUsed')),
      h('ul', { class: 'plain-list' }, used.map((i) => h('li', { class: 'row-between' },
        h('span', {}, i.person_id ? displayName(person(i.person_id)) : t('admin.invitesNewProfile')),
        h('span', { class: 'small muted' }, t('admin.invitesUsedAt', { date: formatWhen(i.used_at) })))))) : null);
}

function newInviteCard(link) {
  return h('div', { class: 'note' },
    h('p', { class: 'small' }, t('admin.invitesLinkReady')),
    h('p', { class: 'mono small', style: 'overflow-wrap:anywhere' }, link),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary btn-sm', href: `https://wa.me/?text=${encodeURIComponent(t('admin.invitesShareText', { link }))}`, target: '_blank', rel: 'noopener' }, t('admin.invitesShare')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(link); toast(t('admin.invitesCopied')); } catch { toast(link); }
      } }, t('admin.invitesCopy')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: dismissNewInviteLink }, t('common.cancel'))));
}

function invitedRow(i) {
  return h('li', { class: 'row-between' },
    h('span', {}, i.person_id ? displayName(person(i.person_id)) : t('admin.invitesNewProfile')),
    h('span', { class: 'row', style: 'justify-content:flex-end' },
      h('span', { class: 'small muted' }, t('admin.invitesExpiresAt', { date: formatWhen(i.expires_at) })),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => revokeInvite(i.id).catch((err) => toast(err.message ?? t('common.error'))) }, t('admin.invitesRevoke'))));
}

/** Recovers a login stuck mid-join (§5a): their account exists (signUp() succeeded) but
 *  redeem_invite() never finished — no members row, so they see "not linked to a family yet".
 *  Normally retrying the invite link finishes the job itself; this is for when that's not
 *  working, or it's just faster to finish it directly than walk a relative through retrying. */
function stuckLoginsSection() {
  const candidates = unclaimedPersons();
  const email = h('input', { id: 'stuck-email', type: 'email', required: true, placeholder: 'name@example.com' });
  const picker = h('select', { id: 'stuck-person' },
    h('option', { value: '' }, t('admin.invitesNewProfile')),
    candidates.map((p) => h('option', { value: p.id }, p.full_name)));
  const linkBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('admin.stuckLink'));
  linkBtn.onclick = async () => {
    if (!email.value.trim()) { toast(t('admin.stuckEmailRequired')); return; }
    linkBtn.disabled = true;
    try {
      await adminLinkMember(email.value, picker.value || null);
      toast(t('admin.stuckLinked'));
      email.value = '';
      picker.value = '';
    } catch (err) {
      toast(err.message ?? t('common.error'));
    } finally {
      linkBtn.disabled = false;
    }
  };

  return h('section', {},
    h('h2', { class: 'section-title' }, t('admin.stuckTitle')),
    h('div', { class: 'card' },
      h('p', { class: 'small muted' }, t('admin.stuckNote')),
      h('label', { for: 'stuck-email' }, t('admin.stuckEmail')),
      email,
      h('label', { for: 'stuck-person' }, t('admin.invitesPerson')),
      picker,
      h('div', { class: 'row' }, linkBtn)));
}

function editCard(r) {
  const p = person(r.target_person_id);
  const own = r.submitted_by === state.meId;
  return h('article', { class: 'card edit-card' },
    h('h3', {}, h('a', { href: `#/person/${p.id}` }, displayName(p))),
    h('p', { class: 'small muted' }, t('admin.by', { name: displayName(person(r.submitted_by)), date: formatDate(r.created_at) })),
    h('dl', { class: 'dl diff' }, Object.entries(r.proposed_changes).filter(([k, v]) => (p[k] ?? null) !== v).map(([k, v]) => h('div', { class: 'dl-row' },
      h('dt', {}, t(`field.${k}`)),
      h('dd', {}, p[k] != null ? h('del', {}, String(p[k])) : null, p[k] != null ? ' → ' : null, h('ins', {}, String(v ?? '—')))))),
    own
      ? h('p', { class: 'small muted' }, t('admin.ownSuggestion'))
      : h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => reviewEdit(r.id, false).catch((err) => toast(err.message ?? t('common.error'))) }, t('admin.reject')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => reviewEdit(r.id, true).catch((err) => toast(err.message ?? t('common.error'))) }, t('admin.approve'))));
}

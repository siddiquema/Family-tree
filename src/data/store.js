// App state, backed by the real Supabase project (supabase/migrations/). Phase 0's access rules
// are the real enforcement; everything client-side here (canEdit, isAdmin, contactView…) is a
// convenience mirror of those rules so the UI can react without round-tripping every check.
import { supabase } from '../lib/supabaseClient.js';
import { buildGraph, isKnownMinor } from '../lib/graph.js';
import { relationship } from '../lib/kinship.js';
import * as familyEdit from '../lib/family-edit.js';
import { personsToCSV, relationshipsToCSV, parsePersonsCSV, parseRelationshipsCSV } from '../lib/csv.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

let lang = 'en';
try { lang = localStorage.getItem('ft.lang') === 'ta' ? 'ta' : 'en'; } catch { /* storage blocked: default */ }

export const state = {
  lang,
  signedIn: false,   // a Supabase session exists
  ready: false,      // and the family's data has finished loading
  authError: null,
  userId: null,
  familyId: null,
  meId: null,
  persons: [],
  relationships: [],
  members: [],
  contacts: {},        // person_id -> { phone, phone_hidden } for whatever RLS lets this viewer see
  noWhatsapp: new Set(),
  source: 'supabase',
  announcements: [],
  editRequests: [],
  terms: [],
  missing: new Map(),  // kinship_missing: path -> lookups, seeded from the table, grows locally too
  invites: [],
  newInviteLink: null, // the one time an admin can see a just-created invite's raw link
  join: null,          // onboarding wizard state while redeeming an invite (src/views/join.js)
  mfaStep: null,        // { factorId } once password is right but an authenticator code is also needed (§5a)
  mfaEnrolled: false,   // this login has a verified authenticator factor on file
};

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
const changed = () => { cachedGraph = null; listeners.forEach((fn) => fn()); };

let cachedGraph = null;
export const graph = () => (cachedGraph ??= buildGraph(state.persons, state.relationships));
export const person = (id) => graph().byId.get(id);
export const me = () => person(state.meId);
export const member = (id) => state.members.find((m) => m.person_id === id);
export const isAdmin = () => member(state.meId)?.role === 'admin';

export function setLang(value) {
  state.lang = value;
  try { localStorage.setItem('ft.lang', value); } catch { /* not persisted */ }
  document.documentElement.lang = value;
  changed();
}

// ─── Auth and loading ────────────────────────────────────────────────────────
/** Email or phone, whichever the member signed up with (§5a) — in practice only email right
 *  now: nobody has a phone-based Supabase Auth identity yet (that needs the SMS/Twilio setup
 *  still deferred), so login.js only offers an email field. Left accepting either here so
 *  signing in with a phone starts working the moment phone accounts exist, with no store.js
 *  change needed. */
export async function signInWithPassword(idOrPhone, password) {
  state.authError = null;
  const isEmail = idOrPhone.includes('@');
  const { error } = await supabase.auth.signInWithPassword(
    isEmail ? { email: idOrPhone.trim(), password } : { phone: idOrPhone.trim(), password });
  if (error) { state.authError = error.message; changed(); return false; }
  await afterPasswordVerified();
  // The password was right, but afterPasswordVerified()/loadEverything() can still fail (e.g.
  // this login has no members row yet) and set state.authError without ever returning false —
  // report that as a failure too, so login.js's toast actually fires instead of silently
  // re-showing the password form with no explanation.
  return state.signedIn || !!state.mfaStep;
}

export async function signOut() {
  await supabase.auth.signOut();
  Object.assign(state, {
    signedIn: false, ready: false, userId: null, familyId: null, meId: null,
    persons: [], relationships: [], members: [], contacts: {}, noWhatsapp: new Set(),
    announcements: [], editRequests: [], terms: [], missing: new Map(), invites: [], newInviteLink: null,
    mfaStep: null, mfaEnrolled: false,
  });
  changed();
}

/** Resumes an existing browser session (page reload) without asking for the password again. */
export async function resumeSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await afterPasswordVerified();
  else changed();
}

/** The password (or a resumed session) checks out, but §5a requires an authenticator-app code
 *  too for anyone with one enrolled — not just admins at signup, but every sign-in afterward,
 *  since Supabase computes nextLevel from whatever factors already exist on the account. Until
 *  that second step finishes, state.signedIn stays false so the login screen keeps showing
 *  (src/views/login.js renders the code prompt instead of the password form while mfaStep is set). */
async function afterPasswordVerified() {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factorId = factors?.totp?.[0]?.id;
    if (factorId) { state.mfaStep = { factorId }; changed(); return; }
  }
  await loadEverything();
}

/** Step two of sign-in, only reached when afterPasswordVerified() found a code is required. */
export async function mfaLoginVerify(code) {
  if (!state.mfaStep) return false;
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.mfaStep.factorId, code: code.trim() });
  if (error) { state.authError = error.message; changed(); return false; }
  state.mfaStep = null;
  await loadEverything();
  return true;
}

// ─── Authenticator-app enrollment (§5a: required for admin powers, optional otherwise) ──────
export async function mfaEnrollStart() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Family Tree' });
  if (error) throw error;
  return data; // { id, totp: { qr_code: <data: URI>, secret, uri } }
}

/** Verifying during enrollment also elevates the current session straight to aal2 — no separate
 *  login step needed right after setting this up. */
export async function mfaEnrollConfirm(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw error;
  state.mfaEnrolled = true;
  changed();
}

async function loadEverything() {
  state.signedIn = true;
  const { data: { user } } = await supabase.auth.getUser();
  state.userId = user.id;

  const { data: mine, error: meErr } = await supabase.from('members')
    .select('family_id, person_id, role, ui_language').eq('user_id', user.id).single();
  if (meErr || !mine) {
    state.authError = 'This login is not linked to a family yet. Ask an admin to add you.';
    state.signedIn = false;
    changed();
    return;
  }
  state.familyId = mine.family_id;
  state.meId = mine.person_id;
  if (mine.ui_language) setLang(mine.ui_language);

  await reloadCore();
  const { data: missingRows } = await supabase.from('kinship_missing').select('path, lookups').eq('family_id', state.familyId);
  state.missing = new Map((missingRows ?? []).map((r) => [r.path, r.lookups]));
  const { data: factors } = await supabase.auth.mfa.listFactors();
  state.mfaEnrolled = (factors?.totp?.length ?? 0) > 0;

  state.ready = true;
  changed();
}

/** Re-fetches everything a mutation could have changed. Simple and correct beats clever for a family this size. */
async function reloadCore() {
  const fid = state.familyId;
  const [persons, relationships, members, contacts, terms, announcements, editRequests, invites] = await Promise.all([
    supabase.from('persons').select('*').eq('family_id', fid).order('created_at'),
    supabase.from('relationships').select('*').eq('family_id', fid),
    supabase.from('members').select('user_id, person_id, role').eq('family_id', fid),
    supabase.from('person_contacts').select('person_id, phone, phone_hidden, has_whatsapp').eq('family_id', fid),
    supabase.from('kinship_terms').select('*').eq('family_id', fid).order('path'),
    supabase.from('announcements').select('*').eq('family_id', fid).order('created_at', { ascending: false }),
    supabase.from('edit_requests').select('*').eq('family_id', fid).order('created_at', { ascending: false }),
    supabase.from('invites').select('id, person_id, created_by, created_at, expires_at, used_at, used_by').eq('family_id', fid).order('created_at', { ascending: false }),
  ]);
  state.persons = persons.data ?? [];
  state.relationships = relationships.data ?? [];
  state.members = members.data ?? [];
  state.contacts = Object.fromEntries((contacts.data ?? []).map((c) => [c.person_id, c]));
  state.noWhatsapp = new Set((contacts.data ?? []).filter((c) => c.has_whatsapp === false).map((c) => c.person_id));
  state.terms = terms.data ?? [];
  state.announcements = announcements.data ?? [];
  state.editRequests = editRequests.data ?? [];
  state.invites = invites.data ?? [];
  changed();
}

// ─── Reads (unchanged logic from the prototype; now reading real data) ──────
export function relationTo(id, from = state.meId) {
  const r = relationship(graph(), state.terms, from, id);
  if (r.kind === 'described' && r.recordable) {
    state.missing.set(r.path, (state.missing.get(r.path) ?? 0) + 1);
    supabase.rpc('record_missing_kinship', { fid: state.familyId, kin_path: r.path }).then(() => {});
  }
  return r;
}

/** §5 edit rights, same rule as app.can_edit_person() in the database. A UI shortcut only — the
 *  database's row-level security is what actually stops a disallowed write. */
export function canEdit(id) {
  if (isAdmin()) return true;
  const g = graph();
  const target = person(id);
  if (g.parentsOf(id).some((p) => p.id === state.meId)) return true;
  if (isKnownMinor(target)) return false;
  return id === state.meId || g.spousesOf(id).some((s) => s.id === state.meId && s.status === 'married');
}
export const canAddRelative = canEdit;
/** Non-admins stay capped at two biological parents (§3). For now, an admin can add a parent of
 *  any subtype even past that cap — e.g. a step-parent beside two biological ones — so a fuller
 *  tree (remarriages, adoptions) can be entered while importing data from elsewhere. The database
 *  still enforces the real limit: a third *biological* parent is rejected regardless of role. */
export const canAddParentTo = (id) => isAdmin() || familyEdit.canAddParent(state.relationships, id);
export function canDelete(id) { return isAdmin() && id !== state.meId; }
export const linkCountOf = (id) => familyEdit.linkCount(state.relationships, id);
export const biologicalParentCountOf = (id) => familyEdit.biologicalParentCount(state.relationships, id);

/** §4.2 phone visibility. `state.contacts` only ever holds what row-level security returned for
 *  this viewer, so "not present" already means "not allowed to see" — no extra check needed. */
export function contactView(id) {
  const c = state.contacts[id];
  if (id === state.meId) return { kind: 'self', phone: c?.phone, hidden: c?.phone_hidden };
  if (c?.phone) return { kind: 'visible', phone: c.phone };
  const g = graph();
  const holders = state.members.map((m) => m.person_id).filter((pid) => pid !== id && g.isImmediateFamily(pid, id));
  return { kind: holders.length || !c ? 'ask' : 'none', askId: holders[0] ?? null };
}

export function nudges(limit = 4) {
  const g = graph();
  const close = [
    ...g.parentsOf(state.meId).map((p) => p.id),
    ...g.parentsOf(state.meId).flatMap((p) => g.parentsOf(p.id).map((gp) => gp.id)),
    ...g.siblingsOf(state.meId),
    ...g.childrenOf(state.meId).map((c) => c.id),
  ];
  const out = [];
  for (const id of new Set(close)) {
    const p = person(id);
    if (!p.name_known) out.push({ id, kind: 'name' });
    else if (p.birth_year == null) out.push({ id, kind: 'birth' });
    else if (p.is_living === null) out.push({ id, kind: 'living' });
    else if (p.is_living === false && !p.house_name && p.birth_year < 1950) out.push({ id, kind: 'house' });
    else if (!p.city && p.is_living && !isKnownMinor(p)) out.push({ id, kind: 'city' });
  }
  return out.slice(0, limit);
}

export function recipients(audience, anchorId) {
  const g = graph();
  let ids;
  if (audience === 'all' || !anchorId) ids = state.members.map((m) => m.person_id);
  else if (audience === 'branch') {
    const seen = new Set([anchorId]);
    const walk = (id) => g.childrenOf(id).forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); walk(c.id); } });
    walk(anchorId);
    g.spousesOf(anchorId).forEach((s) => seen.add(s.id));
    ids = state.members.map((m) => m.person_id).filter((id) => seen.has(id));
  } else {
    ids = state.members.map((m) => m.person_id).filter((id) => id === anchorId || g.isImmediateFamily(anchorId, id));
  }
  return { count: ids.length, sms: ids.filter((id) => state.noWhatsapp.has(id)).length };
}

// ─── Writes: each persists to Supabase, then reloads the shared tables ──────
export async function updatePerson(id, changes) {
  const { error } = await supabase.from('persons').update(changes).eq('id', id);
  if (error) throw error;
  await reloadCore();
}

export async function addFamilyMember(id, kind, parentSubtype = 'biological') {
  if (!canAddRelative(id)) return null;
  const { data: row, error: insErr } = await supabase.from('persons')
    .insert({ family_id: state.familyId, name_known: false, created_by: state.userId }).select('id').single();
  if (insErr) throw insErr;
  const newId = row.id;
  const links = kind === 'parent' ? [{ person_a: newId, person_b: id, type: 'parent_of', subtype: parentSubtype }]
    : kind === 'spouse' ? [{ person_a: [id, newId].sort()[0], person_b: [id, newId].sort()[1], type: 'spouse_of', status: 'married' }]
    : (() => {
        const spouses = graph().spousesOf(id).filter((s) => s.status === 'married');
        const rows = [{ person_a: id, person_b: newId, type: 'parent_of', subtype: 'biological' }];
        if (spouses.length === 1) rows.push({ person_a: spouses[0].id, person_b: newId, type: 'parent_of', subtype: 'biological' });
        return rows;
      })();
  const { error: relErr } = await supabase.from('relationships').insert(links.map((l) => ({ ...l, family_id: state.familyId, created_by: state.userId })));
  if (relErr) { await supabase.from('persons').delete().eq('id', newId); throw relErr; }
  await reloadCore();
  return newId;
}

export async function deletePerson(id) {
  if (!canDelete(id)) return false;
  const { error } = await supabase.from('persons').delete().eq('id', id);
  if (error) throw error;
  await reloadCore();
  return true;
}

export async function suggestEdit(id, changes) {
  const { error } = await supabase.from('edit_requests')
    .insert({ family_id: state.familyId, target_person_id: id, proposed_changes: changes, submitted_by: state.userId });
  if (error) throw error;
  await reloadCore();
}

export async function reviewEdit(requestId, approve) {
  const req = state.editRequests.find((r) => r.id === requestId);
  if (!req || req.submitted_by === state.userId) return;
  const { error } = await supabase.from('edit_requests')
    .update({ status: approve ? 'approved' : 'rejected', reviewed_by: state.userId, reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
  if (approve) await updatePerson(req.target_person_id, req.proposed_changes);
  else await reloadCore();
}

export async function setVerified(path, verified) {
  const t = state.terms.find((x) => x.path === path);
  if (!t || !t.label_ta_local) return;
  const { error } = await supabase.from('kinship_terms').update({ is_verified: verified }).eq('id', t.id);
  if (error) throw error;
  await reloadCore();
}

/** Stored as pending_approval regardless of role: the database only lets a server-side
 *  Edge Function (not yet built — §5b) flip status to 'sent', so this never reaches the wider
 *  family's feed on its own yet. It's still saved, and the sender/admins can see their own draft. */
export async function addAnnouncement(a) {
  const { error } = await supabase.from('announcements')
    .insert({ family_id: state.familyId, created_by: state.userId, status: 'pending_approval', ...a });
  if (error) throw error;
  await reloadCore();
}

// ─── Admin: invites (§5a). Only the raw token is useful to share — stored as a hash (§3), so it
// can only ever be shown once, right after creation. ──────────────────────────────────────────
export function unclaimedPersons() {
  const claimed = new Set(state.members.map((m) => m.person_id));
  return state.persons.filter((p) => p.name_known && !claimed.has(p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function createInvite(personId) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { error } = await supabase.from('invites').insert({
    family_id: state.familyId, token_hash: `\\x${hash}`, person_id: personId || null,
    created_by: state.userId, expires_at: expiresAt,
  });
  if (error) throw error;
  await reloadCore();
  state.newInviteLink = `${location.origin}${location.pathname}#/join?token=${token}`;
  changed();
}

export function dismissNewInviteLink() {
  state.newInviteLink = null;
  changed();
}

export async function revokeInvite(id) {
  const { error } = await supabase.from('invites').delete().eq('id', id);
  if (error) throw error;
  await reloadCore();
}

/** Recovers a login stuck mid-join: they have a working Supabase Auth account (signUp()
 *  succeeded) but redeem_invite() never finished, so there's no members row and they see
 *  "not linked to a family yet". Normally retrying the invite link finishes the job itself —
 *  this is the escape hatch for when that's not working, same effect as
 *  scripts/create-member.mjs, without needing terminal/database access. */
export async function adminLinkMember(email, personId) {
  const { error } = await supabase.rpc('admin_link_member',
    { fid: state.familyId, p_email: email.trim(), p_person_id: personId });
  if (error) throw error;
  await reloadCore();
}

// ─── Onboarding (§5a): a relative redeeming an invite link, before they're a member of anything.
// Phone is not verified — there's no SMS provider wired up yet (Twilio + India DLT needs
// Siddique's sign-off on the cost first), so the number typed here is only ever stored, never
// proven; redeem_invite() leaves person_contacts.phone_verified_at null to keep that gap visible
// in the data itself.
//
// TEMPORARY (08 Oct 26): email is not verified either, right now. The real flow — Supabase's own
// email OTP (joinSendCode/joinVerifyCode below, unused while this is in effect) — hit "email rate
// limit exceeded" during actual use: Supabase's built-in sender is too rate-limited for real
// traffic, and a real SMTP provider isn't configured yet (CLAUDE.md §2). Until then, joinSimple()
// below creates the account directly with supabase.auth.signUp() and passes
// p_email_verified: false to redeem_invite(), so — like the phone number — the email is recorded
// but not claimed as proven. Revert: once SMTP is working, switch startJoin's initial step back
// to 'email' and wire the UI through joinSendCode → joinVerifyCode → joinFinish again. ──────────
export function startJoin(token) {
  if (state.join?.token === token) return;
  state.join = { token, step: 'details', email: '', error: null, busy: false };
  changed();
}

export async function joinSimple({ email, phone, password }) {
  state.join = { ...state.join, busy: true, error: null };
  changed();
  try {
    const { error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    if (signUpError) {
      // Retrying after redeem_invite failed on an earlier attempt: signUp already created this
      // login then, so it isn't "already registered" to anyone else — it's this same person,
      // not yet linked to the family (the whole point of the step that failed). Sign into it
      // instead of treating this as a dead end, same password they just typed.
      const alreadyExists = /already registered|user_already_exists/i.test(signUpError.message ?? '');
      if (!alreadyExists) throw signUpError;
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw new Error('This email is already registered, and that password doesn\'t match it. '
        + 'If you remember trying before, use the password you set then — or ask the admin to reset that login.');
    }
    const { error: rpcError } = await supabase.rpc('redeem_invite',
      { p_token: state.join.token, p_phone: phone || null, p_email_verified: false });
    if (rpcError) throw rpcError;
    state.join = null;
    await loadEverything();
    location.hash = '#/';
  } catch (err) {
    state.join = { ...state.join, busy: false, error: err.message };
    changed();
  }
}

// ─── Unused while joinSimple() is in effect (see the TEMPORARY note above) — kept so switching
// back once SMTP is configured is a UI change, not a rewrite. ───────────────────────────────────
export async function joinSendCode(email) {
  state.join = { ...state.join, busy: true, error: null };
  changed();
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  state.join = { ...state.join, busy: false, email: email.trim(), error: error?.message ?? null, step: error ? 'email' : 'code' };
  changed();
}

export async function joinVerifyCode(code) {
  state.join = { ...state.join, busy: true, error: null };
  changed();
  const { error } = await supabase.auth.verifyOtp({ email: state.join.email, token: code.trim(), type: 'email' });
  state.join = { ...state.join, busy: false, error: error?.message ?? null, step: error ? 'code' : 'details' };
  changed();
}

export async function joinFinish({ phone, password }) {
  state.join = { ...state.join, busy: true, error: null };
  changed();
  try {
    const { error: rpcError } = await supabase.rpc('redeem_invite', { p_token: state.join.token, p_phone: phone || null });
    if (rpcError) throw rpcError;
    const { error: pwError } = await supabase.auth.updateUser({ password });
    if (pwError) throw pwError;
    state.join = null;
    await loadEverything();
    location.hash = '#/';
  } catch (err) {
    state.join = { ...state.join, busy: false, error: err.message };
    changed();
  }
}

// ─── Admin: CSV (Excel round trip). Export reflects the live data; import stays local to this
// browser tab only — real changes to Supabase still go through scripts/import-seed.mjs (docs/
// database.md), so an Excel mistake can never silently overwrite the shared family tree. ──────
export function exportFamilyCSV() {
  if (!isAdmin()) return null;
  return { personsCSV: personsToCSV(state.persons), relationshipsCSV: relationshipsToCSV(state.relationships) };
}

export function importFamilyCSV(personsText, relationshipsText) {
  if (!isAdmin()) return { ok: false, errors: ['Only an admin can update the family data.'] };
  const { persons, errors: personErrors } = parsePersonsCSV(personsText);
  const personIds = new Set(persons.map((p) => p.id));
  const { relationships, errors: relErrors } = parseRelationshipsCSV(relationshipsText, personIds);
  const errors = [...personErrors, ...relErrors];
  for (const m of state.members) {
    if (!personIds.has(m.person_id)) errors.push(`"${m.person_id}" is a signed-in member and must stay in persons.csv`);
  }
  const byChild = new Map();
  for (const r of relationships) {
    if (r.type === 'parent_of' && r.subtype === 'biological') byChild.set(r.person_b, (byChild.get(r.person_b) ?? 0) + 1);
  }
  for (const [child, count] of byChild) {
    if (count > 2) errors.push(`"${child}" has ${count} biological parents listed; at most two are allowed`);
  }
  if (errors.length) return { ok: false, errors };
  state.persons = persons;
  state.relationships = relationships;
  changed();
  return { ok: true, people: persons.length, relationships: relationships.length };
}

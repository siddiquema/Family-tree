// App state for the prototype, backed by the demo family in memory.
// Phase 1 replaces the loading and the mutations with Supabase calls; the screens only use
// the functions exported here, and the database's access rules stay the real enforcement.
import * as demo from '@family-data';
import { kinshipTerms } from './kinship-seed.js';
import { buildGraph, isKnownMinor } from '../lib/graph.js';
import { relationship } from '../lib/kinship.js';
import * as familyEdit from '../lib/family-edit.js';
import { personsToCSV, relationshipsToCSV, parsePersonsCSV, parseRelationshipsCSV } from '../lib/csv.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
let lang = 'en';
try { lang = localStorage.getItem('ft.lang') === 'ta' ? 'ta' : 'en'; } catch { /* storage blocked: default */ }

export const state = {
  lang,
  signedIn: false,
  meId: demo.me,
  persons: clone(demo.persons),
  relationships: clone(demo.relationships),
  members: clone(demo.members),
  contacts: clone(demo.contacts),
  noWhatsapp: new Set(demo.noWhatsapp ?? []),
  source: demo.source ?? 'demo',
  announcements: clone(demo.announcements),
  editRequests: clone(demo.editRequests),
  terms: clone(kinshipTerms),
  missing: new Map(),          // kinship_missing: path → lookups
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
export function signIn() { state.signedIn = true; changed(); }
/** Prototype only: see the app as another member, to check what each relative can see and do. */
export function viewAs(personId) { state.meId = personId; changed(); }
export function signOut() { state.signedIn = false; changed(); }

export function relationTo(id, from = state.meId) {
  const r = relationship(graph(), state.terms, from, id);
  if (r.kind === 'described' && r.recordable) state.missing.set(r.path, (state.missing.get(r.path) ?? 0) + 1);
  return r;
}

/** §5 edit rights, same rule as app.can_edit_person() in the database. */
export function canEdit(id) {
  if (isAdmin()) return true;
  const g = graph();
  const target = person(id);
  if (g.parentsOf(id).some((p) => p.id === state.meId)) return true;
  if (isKnownMinor(target)) return false;
  return id === state.meId || g.spousesOf(id).some((s) => s.id === state.meId && s.status === 'married');
}

/** Adding a relative to someone is part of editing their branch, so the same rule applies. */
export const canAddRelative = canEdit;
/** Whether a biological parent can still be added (the §3 two-parent limit). */
export const canAddParentTo = (id) => familyEdit.canAddParent(state.relationships, id);
/** Removing a person matches the database's admin-only delete policy. Never your own record. */
export function canDelete(id) { return isAdmin() && id !== state.meId; }
export const linkCountOf = (id) => familyEdit.linkCount(state.relationships, id);

/** Adds a blank placeholder relative (§5 "Add upward/downward") and returns the new person's id. */
export function addFamilyMember(id, kind) {
  if (!canAddRelative(id)) return null;
  let newPersonId = null;
  if (kind === 'parent') newPersonId = familyEdit.addParent(state.persons, state.relationships, id);
  else if (kind === 'child') newPersonId = familyEdit.addChild(state.persons, state.relationships, id);
  else if (kind === 'spouse') newPersonId = familyEdit.addSpouse(state.persons, state.relationships, id);
  if (newPersonId) changed();
  return newPersonId;
}

/** Removes a person and the relationships that name them. Admin only, never the signed-in person. */
export function deletePerson(id) {
  if (!canDelete(id)) return false;
  const ok = familyEdit.removePerson(state.persons, state.relationships, id);
  if (ok) changed();
  return ok;
}

/** §4.2 phone visibility: self, immediate family, else who to ask. Admins get no special access. */
export function contactView(id) {
  const c = state.contacts[id];
  if (id === state.meId) return { kind: 'self', phone: c?.phone, hidden: c?.phone_hidden };
  if (!c?.phone) return { kind: 'none' };
  const g = graph();
  if (!c.phone_hidden && g.isImmediateFamily(state.meId, id)) return { kind: 'visible', phone: c.phone };
  const holders = state.members.map((m) => m.person_id).filter((pid) => pid !== id && g.isImmediateFamily(pid, id));
  return { kind: 'ask', askId: c.phone_hidden ? null : holders[0] ?? null };
}

/** Missing-info prompts for the people closest to me (§5 nudges). */
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

export function updatePerson(id, changes) {
  Object.assign(person(id), changes);
  changed();
}

export function suggestEdit(id, changes) {
  state.editRequests.unshift({ id: `e${Date.now()}`, target_person_id: id, submitted_by: state.meId,
    status: 'pending', created_at: new Date().toISOString().slice(0, 10), proposed_changes: changes });
  changed();
}

export function reviewEdit(requestId, approve) {
  const req = state.editRequests.find((r) => r.id === requestId);
  if (!req || req.submitted_by === state.meId) return;
  req.status = approve ? 'approved' : 'rejected';
  if (approve) Object.assign(person(req.target_person_id), req.proposed_changes);
  changed();
}

export function setVerified(path, verified) {
  const t = state.terms.find((x) => x.path === path);
  if (t && t.label_ta_local) { t.is_verified = verified; changed(); }
}

/** Recipients for an announcement: all members, a branch (descendants of X), or X's immediate family. */
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

export function addAnnouncement(a) {
  state.announcements.unshift({ id: `a${Date.now()}`, created_by: state.meId,
    sent_at: new Date().toISOString().slice(0, 10), ...a });
  changed();
}

// ─── Admin: family-data export/import (CSV, matching seed/persons.csv & relationships.csv) ──
/** persons.csv and relationships.csv text for the current state. Admin only. */
export function exportFamilyCSV() {
  if (!isAdmin()) return null;
  return { personsCSV: personsToCSV(state.persons), relationshipsCSV: relationshipsToCSV(state.relationships) };
}

/**
 * Replaces the whole family with what's in the two uploaded CSVs. Admin only. Validates both
 * files first and applies nothing if anything is wrong, so a bad edit in Excel cannot leave
 * the prototype half updated.
 */
export function importFamilyCSV(personsText, relationshipsText) {
  if (!isAdmin()) return { ok: false, errors: ['Only an admin can update the family data.'] };
  const { persons, errors: personErrors } = parsePersonsCSV(personsText);
  const personIds = new Set(persons.map((p) => p.id));
  const { relationships, errors: relErrors } = parseRelationshipsCSV(relationshipsText, personIds);
  const errors = [...personErrors, ...relErrors];

  // Every signed-in member needs to keep a profile, or they'd be signed in as nobody.
  for (const m of state.members) {
    if (!personIds.has(m.person_id)) errors.push(`"${m.person_id}" is a signed-in member and must stay in persons.csv`);
  }
  // The §3 limit of two biological parents, re-checked across the whole file.
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

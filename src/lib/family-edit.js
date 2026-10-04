// Mutations behind the press-and-hold menu (add parent/child/spouse, remove).
// Pure functions over plain {persons, relationships} arrays, mirroring the integrity rules in
// supabase/migrations/…02_integrity_triggers.sql, so the prototype cannot build data the real
// database would reject. src/data/store.js wires these to app state; Phase 1 replaces that
// wiring with Supabase calls, but these rules stay the same.
import { buildGraph } from './graph.js';

let counter = 0;
/** Placeholder id for a person created in the browser. Real ids come from the database (uuid). */
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export function blankPerson(id, overrides = {}) {
  return {
    id, full_name: null, name_known: false, known_as: null, house_name: null,
    gender: 'unknown', birth_year: null, birth_date: null, is_living: null,
    death_year: null, notes: null, native_place: null, city: null, ...overrides,
  };
}

/** Biological parents already on record (the §3 two-parent limit; step/adoptive don't count). */
export function biologicalParentCount(relationships, personId) {
  return relationships.filter((r) => r.type === 'parent_of' && r.subtype === 'biological' && r.person_b === personId).length;
}
export function canAddParent(relationships, personId) {
  return biologicalParentCount(relationships, personId) < 2;
}

function link(relationships, a, b, type, extra) {
  relationships.push({ person_a: a, person_b: b, type, subtype: null, status: null, ...extra });
}

/** Adds a new biological parent above `personId`. Returns the new id, or null if two are already recorded. */
export function addParent(persons, relationships, personId) {
  if (!canAddParent(relationships, personId)) return null;
  const id = newId('new_p');
  persons.push(blankPerson(id));
  link(relationships, id, personId, 'parent_of', { subtype: 'biological' });
  return id;
}

/** Adds a new biological child below `personId`, also linked to their one married spouse if they have exactly one. */
export function addChild(persons, relationships, personId) {
  const id = newId('new_c');
  persons.push(blankPerson(id));
  link(relationships, personId, id, 'parent_of', { subtype: 'biological' });
  const spouses = buildGraph(persons, relationships).spousesOf(personId).filter((sp) => sp.status === 'married');
  if (spouses.length === 1) link(relationships, spouses[0].id, id, 'parent_of', { subtype: 'biological' });
  return id;
}

/** Adds a new spouse for `personId`, stored as the canonical (lower id first) pair, as spouse_of rows are. */
export function addSpouse(persons, relationships, personId) {
  const id = newId('new_s');
  persons.push(blankPerson(id));
  const [a, b] = [personId, id].sort();
  link(relationships, a, b, 'spouse_of', { status: 'married' });
  return id;
}

/** Removes a person and every relationship that names them, matching the database's ON DELETE CASCADE. */
export function removePerson(persons, relationships, personId) {
  const idx = persons.findIndex((p) => p.id === personId);
  if (idx === -1) return false;
  persons.splice(idx, 1);
  for (let i = relationships.length - 1; i >= 0; i--) {
    if (relationships[i].person_a === personId || relationships[i].person_b === personId) relationships.splice(i, 1);
  }
  return true;
}

/** How many relationship rows mention this person, for a "this will remove N links" warning. */
export function linkCount(relationships, personId) {
  return relationships.filter((r) => r.person_a === personId || r.person_b === personId).length;
}

// Family graph built from the two stored link types (CLAUDE.md §3).
// Mirrors the database helpers in supabase/migrations/…03_access_rules.sql so the UI
// and the access rules agree on who counts as family.

/**
 * @typedef {{ id: string, full_name: string|null, name_known: boolean, gender: 'male'|'female'|'unknown',
 *   birth_year: number|null, birth_date?: string|null, is_living: boolean|null, death_year?: number|null,
 *   adult_confirmed?: boolean, house_name?: string|null, known_as?: string|null }} Person
 * @typedef {{ person_a: string, person_b: string, type: 'parent_of'|'spouse_of',
 *   subtype?: 'biological'|'adoptive'|'step'|null, status?: 'married'|'divorced'|'widowed'|null }} Relationship
 */

/** @param {Person[]} persons @param {Relationship[]} relationships */
export function buildGraph(persons, relationships) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const parents = new Map();
  const children = new Map();
  const spouses = new Map();
  const push = (map, key, value) => (map.get(key) ?? map.set(key, []).get(key)).push(value);

  for (const r of relationships) {
    if (r.type === 'parent_of') {
      push(parents, r.person_b, { id: r.person_a, subtype: r.subtype ?? 'biological' });
      push(children, r.person_a, { id: r.person_b, subtype: r.subtype ?? 'biological' });
    } else {
      push(spouses, r.person_a, { id: r.person_b, status: r.status ?? 'married' });
      push(spouses, r.person_b, { id: r.person_a, status: r.status ?? 'married' });
    }
  }

  const parentsOf = (id) => parents.get(id) ?? [];
  const childrenOf = (id) => children.get(id) ?? [];
  const spousesOf = (id) => spouses.get(id) ?? [];

  /** Siblings share a biological or adoptive parent; a step link makes a parent, not a sibling. */
  function siblingsOf(id) {
    const result = new Set();
    for (const p of parentsOf(id)) {
      if (p.subtype === 'step') continue;
      for (const c of childrenOf(p.id)) if (c.id !== id && c.subtype !== 'step') result.add(c.id);
    }
    return [...result];
  }

  function isImmediateFamily(a, b) {
    if (!a || !b || a === b) return false;
    return parentsOf(a).some((p) => p.id === b)
      || childrenOf(a).some((c) => c.id === b)
      || spousesOf(a).some((s) => s.id === b && s.status === 'married')
      || siblingsOf(a).includes(b);
  }

  return { byId, parentsOf, childrenOf, spousesOf, siblingsOf, isImmediateFamily };
}

/** Under 18 at read time. Unknown birth year counts as a minor unless deceased or confirmed adult (§3). */
export function isMinor(person, today = new Date()) {
  if (person.is_living === false || person.adult_confirmed) return false;
  if (person.birth_date) {
    const eighteen = new Date(person.birth_date);
    eighteen.setFullYear(eighteen.getFullYear() + 18);
    return eighteen > today;
  }
  if (person.birth_year != null) return today.getFullYear() - person.birth_year <= 18;
  return true;
}

/** Minor with a recorded birth year. Edit rights use this, so unknown-age ancestors stay editable. */
export function isKnownMinor(person, today = new Date()) {
  if (person.birth_year == null && !person.birth_date) return false;
  return isMinor(person, today);
}

/** Older-first comparison on birth date, else birth year. Null when either is unknown or equal. */
export function compareAge(a, b) {
  const key = (p) => (p.birth_date ? p.birth_date : p.birth_year != null ? `${p.birth_year}` : null);
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return null;
  const ya = Number(ka.slice(0, 4));
  const yb = Number(kb.slice(0, 4));
  if (ya !== yb) return ya < yb ? -1 : 1;
  if (a.birth_date && b.birth_date && a.birth_date !== b.birth_date) return a.birth_date < b.birth_date ? -1 : 1;
  return null;
}

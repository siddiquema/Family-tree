// CSV import/export for the admin "Family data" screen. The column set matches
// seed/persons.csv and seed/relationships.csv exactly, so a file exported here can be saved
// over those files and loaded with scripts/import-seed.mjs or scripts/seed-to-sql.mjs —
// the same path used to get data into Supabase (CLAUDE.md §9).
export const PERSON_COLUMNS = [
  'id', 'full_name', 'name_known', 'known_as', 'house_name', 'gender',
  'birth_year', 'birth_date', 'is_living', 'death_year', 'native_place', 'city', 'notes',
];
export const RELATIONSHIP_COLUMNS = ['person_a', 'person_b', 'type', 'subtype', 'status'];

// ─── Generic RFC-4180-ish parse/stringify ────────────────────────────────────
/** Parses a CSV file (with a header row) into an array of { column: value } objects. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip; \n ends the row */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((col, i) => [col, r[i] ?? ''])));
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvField(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// ─── Persons ────────────────────────────────────────────────────────────────
const GENDER_TO_LETTER = { male: 'M', female: 'F', unknown: '' };
const LETTER_TO_GENDER = { M: 'male', F: 'female', '': 'unknown' };
const INT_RE = /^-?\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function personsToCSV(persons) {
  return toCSV(persons.map((p) => ({
    id: p.id,
    full_name: p.name_known ? (p.full_name ?? '') : '',
    name_known: p.name_known ? 'true' : 'false',
    known_as: p.known_as ?? '',
    house_name: p.house_name ?? '',
    gender: GENDER_TO_LETTER[p.gender] ?? '',
    birth_year: p.birth_year ?? '',
    birth_date: p.birth_date ?? '',
    is_living: p.is_living === true ? 'true' : p.is_living === false ? 'false' : '',
    death_year: p.death_year ?? '',
    native_place: p.native_place ?? '',
    city: p.city ?? '',
    notes: p.notes ?? '',
  })), PERSON_COLUMNS);
}

/** Parses and validates a persons.csv. Returns the usable rows plus any problems found. */
export function parsePersonsCSV(text) {
  const errors = [];
  const seen = new Set();
  const persons = [];
  parseCSV(text).forEach((row, i) => {
    const line = i + 2; // header is line 1
    const id = (row.id ?? '').trim();
    if (!id) { errors.push(`Row ${line}: missing id`); return; }
    if (seen.has(id)) { errors.push(`Row ${line}: duplicate id "${id}"`); return; }
    seen.add(id);

    const nameKnown = (row.name_known ?? '').trim().toLowerCase() !== 'false';
    const fullName = (row.full_name ?? '').trim() || null;
    if (nameKnown && !fullName) { errors.push(`Row ${line} (${id}): full_name is required unless name_known is false`); return; }
    if (!nameKnown && fullName) { errors.push(`Row ${line} (${id}): name_known is false but full_name is set`); return; }

    const genderRaw = (row.gender ?? '').trim().toUpperCase();
    if (genderRaw && !(genderRaw in LETTER_TO_GENDER)) { errors.push(`Row ${line} (${id}): gender must be M, F or blank`); return; }

    const birthYear = (row.birth_year ?? '').trim();
    if (birthYear && !INT_RE.test(birthYear)) { errors.push(`Row ${line} (${id}): birth_year must be a whole number`); return; }
    const deathYear = (row.death_year ?? '').trim();
    if (deathYear && !INT_RE.test(deathYear)) { errors.push(`Row ${line} (${id}): death_year must be a whole number`); return; }
    if (birthYear && deathYear && Number(deathYear) < Number(birthYear)) { errors.push(`Row ${line} (${id}): death_year is before birth_year`); return; }

    const birthDate = (row.birth_date ?? '').trim();
    if (birthDate && !DATE_RE.test(birthDate)) { errors.push(`Row ${line} (${id}): birth_date must be YYYY-MM-DD`); return; }

    const livingRaw = (row.is_living ?? '').trim().toLowerCase();
    if (livingRaw && livingRaw !== 'true' && livingRaw !== 'false') { errors.push(`Row ${line} (${id}): is_living must be true, false or blank`); return; }

    persons.push({
      id, full_name: nameKnown ? fullName : null, name_known: nameKnown,
      known_as: (row.known_as ?? '').trim() || null,
      house_name: (row.house_name ?? '').trim() || null,
      gender: genderRaw ? LETTER_TO_GENDER[genderRaw] : 'unknown',
      birth_year: birthYear ? Number(birthYear) : null,
      birth_date: birthDate || null,
      is_living: livingRaw === 'true' ? true : livingRaw === 'false' ? false : null,
      death_year: deathYear ? Number(deathYear) : null,
      native_place: (row.native_place ?? '').trim() || null,
      city: (row.city ?? '').trim() || null,
      notes: (row.notes ?? '').trim() || null,
    });
  });
  return { persons, errors };
}

// ─── Relationships ──────────────────────────────────────────────────────────
export function relationshipsToCSV(relationships) {
  return toCSV(relationships.map((r) => ({
    person_a: r.person_a, person_b: r.person_b, type: r.type,
    subtype: r.subtype ?? '', status: r.status ?? '',
  })), RELATIONSHIP_COLUMNS);
}

/** Parses and validates a relationships.csv against a known set of person ids. */
export function parseRelationshipsCSV(text, personIds) {
  const errors = [];
  const relationships = [];
  const seenPairs = new Set();
  parseCSV(text).forEach((row, i) => {
    const line = i + 2;
    let a = (row.person_a ?? '').trim();
    let b = (row.person_b ?? '').trim();
    const type = (row.type ?? '').trim();
    if (!a || !b) { errors.push(`Row ${line}: person_a and person_b are both required`); return; }
    if (type !== 'parent_of' && type !== 'spouse_of') { errors.push(`Row ${line}: type must be parent_of or spouse_of`); return; }
    if (!personIds.has(a)) { errors.push(`Row ${line}: person_a "${a}" is not in persons.csv`); return; }
    if (!personIds.has(b)) { errors.push(`Row ${line}: person_b "${b}" is not in persons.csv`); return; }
    if (a === b) { errors.push(`Row ${line}: "${a}" cannot be linked to themselves`); return; }

    let subtype = (row.subtype ?? '').trim() || null;
    let status = (row.status ?? '').trim() || null;
    if (type === 'parent_of') {
      subtype = subtype || 'biological';
      if (!['biological', 'adoptive', 'step'].includes(subtype)) { errors.push(`Row ${line}: subtype must be biological, adoptive or step`); return; }
      status = null;
    } else {
      if (a > b) [a, b] = [b, a]; // spouse pairs are stored lower id first
      status = status || 'married';
      if (!['married', 'divorced', 'widowed'].includes(status)) { errors.push(`Row ${line}: status must be married, divorced or widowed`); return; }
      subtype = null;
    }

    const key = `${type}:${a}:${b}`;
    if (seenPairs.has(key)) { errors.push(`Row ${line}: duplicate link between "${a}" and "${b}"`); return; }
    seenPairs.add(key);
    relationships.push({ person_a: a, person_b: b, type, subtype, status });
  });
  return { relationships, errors };
}

// Turns seed/persons.csv and seed/relationships.csv into a data module the prototype can run on,
// in place of the made-up demo family. Output holds real family data: it goes to seed/ (gitignored).
//
//   ME=<seed id of the viewer> node scripts/seed-to-app-data.mjs > seed/family-data.js
//   FAMILY_DATA=seed/family-data.js npx vite build --outDir seed/app
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

const dir = process.argv[2] ?? 'seed';
const read = (f) => parse(readFileSync(join(dir, f)), { columns: true, skip_empty_lines: true });
const blank = (v) => (v == null || v.trim() === '' ? null : v.trim());
const int = (v) => (blank(v) === null ? null : Number.parseInt(v, 10));
const GENDER = { M: 'male', F: 'female' };

const persons = read('persons.csv').map((p) => ({
  id: p.id,
  full_name: p.name_known === 'false' ? null : blank(p.full_name),
  name_known: p.name_known !== 'false',
  known_as: blank(p.known_as),
  house_name: blank(p.house_name),
  gender: GENDER[p.gender] ?? 'unknown',
  birth_year: int(p.birth_year),
  birth_date: blank(p.birth_date),
  is_living: p.is_living === '' ? null : p.is_living === 'true',
  death_year: int(p.death_year),
  notes: blank(p.notes),
  native_place: null,
  city: null,
}));
const relationships = read('relationships.csv').map((r) => ({
  person_a: r.person_a, person_b: r.person_b, type: r.type,
  subtype: r.type === 'parent_of' ? (blank(r.subtype) ?? 'biological') : null,
  status: r.type === 'spouse_of' ? (blank(r.status) ?? 'married') : null,
}));

const me = process.env.ME;
if (!persons.some((p) => p.id === me)) {
  console.error('Set ME to the seed id of the person viewing the prototype.');
  process.exit(1);
}

const module = {
  source: 'seed',
  persons,
  relationships,
  members: [{ person_id: me, role: 'admin' }],
  me,
  contacts: {},
  noWhatsapp: [],
  announcements: [],
  editRequests: [],
};
process.stdout.write(`// Generated from the family spreadsheet. Private: never commit.\n${
  Object.entries(module).map(([k, v]) => `export const ${k} = ${JSON.stringify(v, null, 1)};`).join('\n')}\n`);

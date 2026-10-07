// Converts a GEDCOM export (e.g. from MacFamilyTree) into the same persons/relationships shape
// as seed/persons.csv (CLAUDE.md §9), plus a report of names that might already be in the live
// family — someone built a second tree from a different branch, and the two likely overlap at
// whoever connects them (a shared parent/child/spouse), so blindly importing everyone as new
// people would duplicate those individuals instead of linking to who's already there.
//
// This script only reads the GEDCOM and the existing seed/persons.csv, and only writes new files
// under seed/ (gitignored, never committed — this is real personal data, same as the rest of
// seed/). It never touches Supabase. Review seed/gedcom_possible_matches.csv, then hand-edit
// seed/gedcom_persons.csv to replace a gedcom_id with the matching real person id for anyone
// confirmed as the same individual, before any of this is imported.
//
//   node scripts/parse-gedcom.mjs path/to/export.ged [seed-dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseCSV } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const gedPath = process.argv[2];
const seedDir = process.argv[3] ?? 'seed';
if (!gedPath) {
  console.error('Usage: node scripts/parse-gedcom.mjs path/to/export.ged [seed-dir]');
  process.exit(1);
}

// ─── Parse into a flat line list, then group into records ───────────────────
const raw = readFileSync(gedPath, 'latin1'); // re-decoded as UTF-8 below once we strip control bytes
const text = Buffer.from(raw, 'latin1').toString('utf8').replace(/\r\n?/g, '\n');
const lines = text.split('\n')
  .map((l) => l.match(/^(\d+)\s(?:(@[^@]+@)\s)?([A-Za-z_][\w]*)(?:\s(.*))?$/))
  .filter(Boolean)
  .map((m) => ({ level: Number(m[1]), xref: m[2] ?? null, tag: m[3], value: (m[4] ?? '').trim() }));

/** Walks a run of lines at depth >= level, returning { node, rest } where node holds this
 *  line's tag/value/xref plus its own children, parsed the same way, one level deeper. */
function readRecord(ls, level) {
  const line = ls[0];
  const children = [];
  let rest = ls.slice(1);
  while (rest.length && rest[0].level > level) {
    const [child, after] = readRecord(rest, rest[0].level);
    children.push(child);
    rest = after;
  }
  return [{ ...line, children }, rest];
}
function readAllRecords(ls) {
  const records = [];
  let rest = ls;
  while (rest.length) {
    const [rec, after] = readRecord(rest, rest[0].level);
    records.push(rec);
    rest = after;
  }
  return records;
}
const records = readAllRecords(lines);
const child = (node, tag) => node?.children.find((c) => c.tag === tag);
const childValue = (node, tag) => child(node, tag)?.value ?? null;

const indis = records.filter((r) => r.tag === 'INDI');
const fams = records.filter((r) => r.tag === 'FAM');
const labels = Object.fromEntries(records.filter((r) => r.tag === 'LABL').map((r) => [r.xref, childValue(r, 'TITL')]));

// ─── Individuals ──────────────────────────────────────────────────────────────
const blank = (v) => (v == null || v.trim() === '' ? null : v.trim());
const yearOf = (dateStr) => {
  const m = dateStr?.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
};
const GENDER = { M: 'male', F: 'female' };

const persons = indis.map((indi) => {
  const nameNode = child(indi, 'NAME');
  let fullName = blank(nameNode?.value.replace(/\/\//g, '').trim());
  let knownAs = null;
  const paren = fullName?.match(/^(.*?)\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (paren) { fullName = paren[1].trim(); knownAs = paren[2].trim(); }

  const birt = child(indi, 'BIRT');
  const deat = child(indi, 'DEAT');
  const resi = child(indi, 'RESI');
  const placParts = (childValue(resi, 'PLAC') ?? '').split(',').map((s) => s.trim());
  const [place, , stateName, country] = placParts;
  const birthPlace = (childValue(birt, 'PLAC') ?? '').split(',').map((s) => s.trim())[0];

  const labelTitle = labels[childValue(indi, 'LABL')];
  const isLiving = labelTitle === 'Deceased' ? false : null; // "Unmarried"/"Married" say nothing about living status

  return {
    gedcom_id: indi.xref,
    full_name: fullName,
    name_known: fullName != null,
    known_as: knownAs,
    house_name: null,
    gender: GENDER[childValue(indi, 'SEX')] ?? 'unknown',
    birth_year: yearOf(childValue(birt, 'DATE')),
    birth_date: null,
    is_living: isLiving,
    death_year: yearOf(childValue(deat, 'DATE')),
    native_place: blank(birthPlace) ?? null,
    city: blank(place),
    state: blank(stateName),
    country: blank(country),
    notes: null,
  };
});
const personByXref = new Map(persons.map((p) => [p.gedcom_id, p]));

// ─── Relationships (parent_of from FAMC/PEDI, spouse_of from HUSB+WIFE) ──────
const relationships = [];
for (const fam of fams) {
  const husb = childValue(fam, 'HUSB');
  const wife = childValue(fam, 'WIFE');
  const children = fam.children.filter((c) => c.tag === 'CHIL');
  if (husb && wife) {
    const [a, b] = [husb, wife].sort();
    relationships.push({ person_a: a, person_b: b, type: 'spouse_of', subtype: '', status: 'married' });
  }
  for (const chil of children) {
    const pedi = childValue(chil, 'PEDI') ?? 'birth';
    const subtype = pedi === 'adopted' ? 'adoptive' : pedi === 'step' ? 'step' : 'biological';
    if (husb) relationships.push({ person_a: husb, person_b: chil.value, type: 'parent_of', subtype, status: '' });
    if (wife) relationships.push({ person_a: wife, person_b: chil.value, type: 'parent_of', subtype, status: '' });
  }
}

// ─── Possible overlaps with the family already in seed/persons.csv ──────────
function normalize(name) {
  return (name ?? '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}
function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) return 0.85;
  const dp = Array.from({ length: shorter.length + 1 }, (_, i) => [i, ...Array(longer.length).fill(0)]);
  for (let j = 0; j <= longer.length; j++) dp[0][j] = j;
  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      dp[i][j] = shorter[i - 1] === longer[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return 1 - dp[shorter.length][longer.length] / longer.length;
}

let existing = [];
try {
  existing = parseCSV(readFileSync(join(seedDir, 'persons.csv')), { columns: true, skip_empty_lines: true });
} catch { /* no existing seed yet: nothing to cross-check */ }

const matches = [];
for (const p of persons) {
  if (!p.full_name) continue;
  const scored = existing
    .map((e) => ({ existing_id: e.id, existing_name: e.full_name, score: similarity(p.full_name, e.full_name) }))
    .filter((m) => m.score >= 0.8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for (const m of scored) {
    matches.push({ gedcom_id: p.gedcom_id, gedcom_name: p.full_name, ...m, score: m.score.toFixed(2) });
  }
}

// ─── Write outputs (seed/ is gitignored — this is real personal data) ───────
const personsCSV = stringify(persons, {
  header: true, columns: Object.keys(persons[0]),
  cast: { boolean: (v) => (v ? 'true' : 'false') }, // csv-stringify defaults booleans to ""/"1"; the
  // rest of the pipeline (scripts/import-seed.mjs, src/lib/csv.js) expects literal "true"/"false"
});
const relationshipsCSV = stringify(relationships, { header: true, columns: ['person_a', 'person_b', 'type', 'subtype', 'status'] });
const matchesCSV = matches.length
  ? stringify(matches, { header: true, columns: ['gedcom_id', 'gedcom_name', 'existing_id', 'existing_name', 'score'] })
  : 'gedcom_id,gedcom_name,existing_id,existing_name,score\n';

writeFileSync(join(seedDir, 'gedcom_persons.csv'), personsCSV);
writeFileSync(join(seedDir, 'gedcom_relationships.csv'), relationshipsCSV);
writeFileSync(join(seedDir, 'gedcom_possible_matches.csv'), matchesCSV);

console.log(`Parsed ${persons.length} people and ${relationships.length} relationships from ${gedPath}.`);
console.log(`Wrote ${seedDir}/gedcom_persons.csv, ${seedDir}/gedcom_relationships.csv.`);
console.log(`${matches.length} possible name overlaps with the existing family written to ${seedDir}/gedcom_possible_matches.csv — review before importing.`);

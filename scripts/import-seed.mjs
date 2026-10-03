// Loads seed/persons.csv and seed/relationships.csv into the database (CLAUDE.md §9).
// Run from Siddique's machine only; the CSVs hold real family data and are gitignored.
//
//   DATABASE_URL=postgres://...  FAMILY_NAME="..."  node scripts/import-seed.mjs [seed-dir]
//
// DATABASE_URL must be the direct Postgres connection (Supabase: Project Settings → Database),
// which bypasses row-level security like the service role. Never commit it.
// Safe to re-run: each CSV row is matched through external_ids (system "seed_xlsx_2011"),
// so a second run updates the same people instead of creating duplicates.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import pg from 'pg';

const SYSTEM = 'seed_xlsx_2011';
const seedDir = process.argv[2] ?? 'seed';
const { DATABASE_URL, FAMILY_NAME } = process.env;
if (!DATABASE_URL || !FAMILY_NAME) {
  console.error('Set DATABASE_URL and FAMILY_NAME.');
  process.exit(1);
}

const read = (file) => parse(readFileSync(join(seedDir, file)), { columns: true, skip_empty_lines: true });
const persons = read('persons.csv');
const relationships = read('relationships.csv');

const blank = (v) => (v === undefined || v.trim() === '' ? null : v.trim());
const int = (v) => (blank(v) === null ? null : Number.parseInt(v, 10));
const GENDER = { M: 'male', F: 'female' };

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query('begin');

  await client.query(
    'insert into families (name) select $1 where not exists (select 1 from families where name = $1)', [FAMILY_NAME]);
  const { rows: [{ id: familyId }] } = await client.query('select id from families where name = $1', [FAMILY_NAME]);

  const SOURCE_TITLE = 'family tree.xlsx (26 Jun 11)';
  await client.query(
    `insert into sources (family_id, kind, title, details)
     select $1, 'spreadsheet', $2, $3 where not exists (select 1 from sources where family_id = $1 and title = $2)`,
    [familyId, SOURCE_TITLE, { transcribed_by: 'seed/transcribe.py', rows: persons.length }]);
  const { rows: [{ id: sourceId }] } = await client.query(
    'select id from sources where family_id = $1 and title = $2', [familyId, SOURCE_TITLE]);

  const idFor = new Map();
  let created = 0;
  let updated = 0;
  for (const p of persons) {
    const nameKnown = p.name_known !== 'false';
    const values = [
      nameKnown ? blank(p.full_name) : null, nameKnown, blank(p.known_as), blank(p.house_name),
      GENDER[p.gender] ?? 'unknown', int(p.birth_year), blank(p.birth_date),
      p.is_living === '' ? null : p.is_living === 'true', int(p.death_year), blank(p.notes),
    ];
    const existing = await client.query(
      'select person_id from external_ids where family_id = $1 and system = $2 and external_id = $3',
      [familyId, SYSTEM, p.id]);
    let personId;
    if (existing.rowCount) {
      personId = existing.rows[0].person_id;
      await client.query(
        `update persons set full_name = $2, name_known = $3, known_as = $4, house_name = $5, gender = $6,
                birth_year = $7, birth_date = $8, is_living = $9, death_year = $10, notes = $11
          where id = $1`, [personId, ...values]);
      updated++;
    } else {
      ({ rows: [{ id: personId }] } = await client.query(
        `insert into persons (family_id, full_name, name_known, known_as, house_name, gender,
                              birth_year, birth_date, is_living, death_year, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`, [familyId, ...values]));
      await client.query(
        'insert into external_ids (family_id, person_id, system, external_id) values ($1, $2, $3, $4)',
        [familyId, personId, SYSTEM, p.id]);
      created++;
    }
    await client.query(
      `insert into person_sources (person_id, source_id, family_id, note) values ($1, $2, $3, $4)
       on conflict do nothing`, [personId, sourceId, familyId, blank(p.notes)]);
    idFor.set(p.id, personId);
  }

  let links = 0;
  for (const r of relationships) {
    let a = idFor.get(r.person_a);
    let b = idFor.get(r.person_b);
    if (!a || !b) throw new Error(`Relationship refers to unknown row: ${r.person_a} → ${r.person_b}`);
    if (r.type === 'spouse_of' && a > b) [a, b] = [b, a];   // spouse pairs are stored lower id first
    const res = await client.query(
      `insert into relationships (family_id, person_a, person_b, type, subtype, status)
       values ($1, $2, $3, $4, $5, $6) on conflict (type, person_a, person_b) do nothing`,
      [familyId, a, b, r.type, r.type === 'parent_of' ? (blank(r.subtype) ?? 'biological') : null,
       r.type === 'spouse_of' ? (blank(r.status) ?? 'married') : null]);
    links += res.rowCount;
  }

  await client.query('commit');
  console.log(`Family ${familyId}: ${created} people added, ${updated} updated, ${links} new links.`);
} catch (err) {
  await client.query('rollback');
  console.error(`Import failed, nothing was saved: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

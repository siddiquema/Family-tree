// Loads seed/gedcom_persons.csv and seed/gedcom_relationships.csv (scripts/parse-gedcom.mjs's
// output) into the database, alongside the 2011-spreadsheet data already there (CLAUDE.md §9).
// Run from Siddique's machine only; the CSVs hold real family data and are gitignored.
//
//   DATABASE_URL=postgres://...  FAMILY_NAME="..."  node scripts/import-gedcom.mjs [seed-dir]
//
// Safe to re-run: each GEDCOM person is matched through external_ids (system "macfamilytree_gedcom"),
// so a second run updates the same people instead of creating duplicates — same pattern as
// scripts/import-seed.mjs.
//
// BRIDGE below is the hand-confirmed list of people who appear in both trees (found by tracing
// parent/spouse structure, not name matching — spellings differ enough between the two sources
// that a name-only check misses them; see seed/gedcom_possible_matches.csv for the rough aid that
// *did* run, and its limits). Each entry says how to find that GEDCOM person's *existing* row,
// so the importer links to it instead of creating a duplicate — critical for Siddique Ahamed
// himself, whose person row is already claimed by the admin login.
const BRIDGE = {
  '@I69480248@': { externalId: 'g4_jinnah' },      // Jinnah -> Ahamed Jinnah
  '@I61209047@': { externalId: 'g4_jinnah_w' },    // Ayesha Jinnah -> Ayeshya Beevi
  '@I26905590@': { externalId: 'g5_jin1' },        // Siddique Ahamed -> Sidique (the admin's own profile)
  '@I90496470@': { externalId: 'g5_jin2' },        // Fathima Jazira -> Fathima Jazeera
  '@I97987376@': { externalId: 'g5_jin3' },        // Fatima Banu -> Fathima Bhanu
  '@I27478616@': { externalId: 'g5_jin4' },        // Sha Navaz -> Shanawaz
  // Added directly in the live app (press-and-hold "Add a child"), so she has no external_id from
  // the 2011 import to match on — matched by name instead. Siddique confirmed 07 Oct 2026 she is
  // Fathima Jazeera's daughter, not his own; FIXUPS below corrects the relationships already in
  // the database that had her the other way around.
  '@I85080674@': { fullName: 'Dhiya Farhaha' },    // Dia Farhana -> (Fathima Jazeera's daughter)
};

// Relationships to remove/add beyond what the GEDCOM itself states, for the Dhiya Farhaha
// correction above. Resolved the same way as BRIDGE (external_id or full-name lookup), applied
// after the main import so her gedcom_id is already resolved to the right person.
const FIXUPS = {
  remove: [
    { parent: { externalId: 'g5_jin1' }, child: { fullName: 'Dhiya Farhaha' } },
    { parent: { externalId: 'g5_jin3' }, child: { fullName: 'Dhiya Farhaha' } },
  ],
  addParent: [
    { parent: { externalId: 'g5_jin4' }, child: { fullName: 'Dhiya Farhaha' }, subtype: 'biological' },
  ],
};

const SYSTEM = 'macfamilytree_gedcom';
const seedDir = process.argv[2] ?? 'seed';
// Accepts a single DATABASE_URL, or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE separately — the
// latter sidesteps URL-encoding a password that happens to contain @, /, #, % or similar, which
// otherwise breaks URL parsing ("Invalid URL") rather than connecting.
const { DATABASE_URL, FAMILY_NAME, PGHOST, PGPASSWORD } = process.env;
if (!FAMILY_NAME || !(DATABASE_URL || (PGHOST && PGPASSWORD))) {
  console.error('Set DATABASE_URL (or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) and FAMILY_NAME.');
  process.exit(1);
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import pg from 'pg';

const read = (file) => parse(readFileSync(join(seedDir, file)), { columns: true, skip_empty_lines: true });
const persons = read('gedcom_persons.csv');
const relationships = read('gedcom_relationships.csv');

const blank = (v) => (v === undefined || v.trim() === '' ? null : v.trim());
const int = (v) => (blank(v) === null ? null : Number.parseInt(v, 10));
const boolOrNull = (v) => (blank(v) === null ? null : v.trim() === 'true');

// pg reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE itself when no connectionString is given.
const client = new pg.Client(DATABASE_URL ? { connectionString: DATABASE_URL } : {});
await client.connect();
try {
  await client.query('begin');

  const { rows: familyRows } = await client.query('select id from families where name = $1', [FAMILY_NAME]);
  if (!familyRows.length) throw new Error(`No family named "${FAMILY_NAME}".`);
  const familyId = familyRows[0].id;

  async function resolveBridge({ externalId, fullName }) {
    if (externalId) {
      const { rows } = await client.query(
        'select person_id from external_ids where family_id = $1 and system = $2 and external_id = $3',
        [familyId, 'seed_xlsx_2011', externalId]);
      if (!rows.length) throw new Error(`Bridge lookup failed: no person with external_id "${externalId}" (seed_xlsx_2011).`);
      return rows[0].person_id;
    }
    const { rows } = await client.query(
      'select id from persons where family_id = $1 and full_name = $2', [familyId, fullName]);
    if (rows.length !== 1) throw new Error(`Bridge lookup failed: ${rows.length} people named "${fullName}" (expected exactly 1).`);
    return rows[0].id;
  }

  const idFor = new Map();
  let created = 0;
  let updated = 0;
  let bridged = 0;
  for (const p of persons) {
    if (BRIDGE[p.gedcom_id]) {
      idFor.set(p.gedcom_id, await resolveBridge(BRIDGE[p.gedcom_id]));
      bridged++;
      continue;
    }
    const nameKnown = p.name_known !== 'false';
    const values = [
      nameKnown ? blank(p.full_name) : null, nameKnown, blank(p.known_as), blank(p.house_name),
      ['male', 'female'].includes(p.gender) ? p.gender : 'unknown',
      int(p.birth_year), blank(p.birth_date), boolOrNull(p.is_living), int(p.death_year),
      blank(p.native_place), blank(p.city), blank(p.state), blank(p.country),
    ];
    const existing = await client.query(
      'select person_id from external_ids where family_id = $1 and system = $2 and external_id = $3',
      [familyId, SYSTEM, p.gedcom_id]);
    let personId;
    if (existing.rowCount) {
      personId = existing.rows[0].person_id;
      await client.query(
        `update persons set full_name = $2, name_known = $3, known_as = $4, house_name = $5, gender = $6,
                birth_year = $7, birth_date = $8, is_living = $9, death_year = $10,
                native_place = $11, city = $12, state = $13, country = $14
          where id = $1`, [personId, ...values]);
      updated++;
    } else {
      ({ rows: [{ id: personId }] } = await client.query(
        `insert into persons (family_id, full_name, name_known, known_as, house_name, gender,
                              birth_year, birth_date, is_living, death_year, native_place, city, state, country)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`, [familyId, ...values]));
      await client.query(
        'insert into external_ids (family_id, person_id, system, external_id) values ($1, $2, $3, $4)',
        [familyId, personId, SYSTEM, p.gedcom_id]);
      created++;
    }
    idFor.set(p.gedcom_id, personId);
  }

  // FIXUPS.remove runs first: the GEDCOM import below adds Fathima Jazeera as Dhiya Farhaha's
  // biological parent, and she already (wrongly) has two — the database's own two-biological-
  // parent limit would reject that third one until the wrong ones are gone.
  let fixed = 0;
  for (const f of FIXUPS.remove) {
    const parentId = await resolveBridge(f.parent);
    const childId = await resolveBridge(f.child);
    const res = await client.query(
      `delete from relationships where family_id = $1 and type = 'parent_of' and person_a = $2 and person_b = $3`,
      [familyId, parentId, childId]);
    fixed += res.rowCount;
  }

  let links = 0;
  for (const r of relationships) {
    let a = idFor.get(r.person_a);
    let b = idFor.get(r.person_b);
    if (!a || !b) throw new Error(`Relationship refers to unknown row: ${r.person_a} -> ${r.person_b}`);
    if (r.type === 'spouse_of' && a > b) [a, b] = [b, a];
    const res = await client.query(
      `insert into relationships (family_id, person_a, person_b, type, subtype, status)
       values ($1, $2, $3, $4, $5, $6) on conflict (type, person_a, person_b) do nothing`,
      [familyId, a, b, r.type, r.type === 'parent_of' ? (blank(r.subtype) ?? 'biological') : null,
       r.type === 'spouse_of' ? (blank(r.status) ?? 'married') : null]);
    links += res.rowCount;
  }

  for (const f of FIXUPS.addParent) {
    const parentId = await resolveBridge(f.parent);
    const childId = await resolveBridge(f.child);
    const res = await client.query(
      `insert into relationships (family_id, person_a, person_b, type, subtype)
       values ($1, $2, $3, 'parent_of', $4) on conflict (type, person_a, person_b) do nothing`,
      [familyId, parentId, childId, f.subtype]);
    fixed += res.rowCount;
  }

  await client.query('commit');
  console.log(`Family ${familyId}: ${created} people added, ${updated} updated, ${bridged} linked to existing people, `
    + `${links} new relationship links, ${fixed} fix-up changes (Dhiya Farhaha's parents).`);
} catch (err) {
  await client.query('rollback');
  console.error(`Import failed, nothing was saved: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

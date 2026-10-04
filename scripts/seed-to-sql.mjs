// Turns seed/persons.csv and seed/relationships.csv into one SQL script that can be pasted
// into the Supabase SQL Editor — for loading the seed from a phone, with no Node or database
// connection on the device. Same result as import-seed.mjs, and equally safe to re-run.
//
//   FAMILY_NAME="..." [ADMIN_EMAIL=... ADMIN_SEED_ID=...] node scripts/seed-to-sql.mjs > seed/seed.sql
//
// The output holds real family data: write it into seed/ (gitignored), never commit it.
// With ADMIN_EMAIL and ADMIN_SEED_ID set, the script also makes that login (created first under
// Authentication → Users) the family admin, linked to the person with that seed id.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

const SYSTEM = 'seed_xlsx_2011';
const SOURCE_TITLE = 'family tree.xlsx (26 Jun 11)';
const seedDir = process.argv[2] ?? 'seed';
const { FAMILY_NAME, ADMIN_EMAIL, ADMIN_SEED_ID } = process.env;
if (!FAMILY_NAME) {
  console.error('Set FAMILY_NAME.');
  process.exit(1);
}

const read = (file) => parse(readFileSync(join(seedDir, file)), { columns: true, skip_empty_lines: true });
const persons = read('persons.csv');
const relationships = read('relationships.csv');
if (ADMIN_SEED_ID && !persons.some((p) => p.id === ADMIN_SEED_ID)) {
  console.error(`No person with seed id ${ADMIN_SEED_ID}.`);
  process.exit(1);
}

const lit = (v) => (v === undefined || v === null || String(v).trim() === '' ? 'null' : `'${String(v).trim().replaceAll("'", "''")}'`);
const num = (v) => (v === undefined || v.trim() === '' ? 'null' : String(Number.parseInt(v, 10)));
const bool = (v) => (v === '' ? 'null' : v === 'true' ? 'true' : 'false');
const GENDER = { M: 'male', F: 'female' };
const fam = `(select id from families where name = ${lit(FAMILY_NAME)})`;

const personRows = persons.map((p) => {
  const known = p.name_known !== 'false';
  return `  (${lit(p.id)}, ${known ? lit(p.full_name) : 'null'}, ${known}, ${lit(p.known_as)}, ${lit(p.house_name)}, `
    + `'${GENDER[p.gender] ?? 'unknown'}', ${num(p.birth_year)}, ${lit(p.birth_date)}::date, ${bool(p.is_living)}, `
    + `${num(p.death_year)}, ${lit(p.native_place)}, ${lit(p.city)}, ${lit(p.notes)})`;
});
const relRows = relationships.map((r) => `  (${lit(r.person_a)}, ${lit(r.person_b)}, ${lit(r.type)}, `
  + `${r.type === 'parent_of' ? lit(r.subtype || 'biological') : 'null'}, ${r.type === 'spouse_of' ? lit(r.status || 'married') : 'null'})`);

const sql = `-- Family seed: ${persons.length} people, ${relationships.length} links. Private — do not share.
-- Paste into Supabase → SQL Editor → Run. Safe to run again: it updates the same people.
begin;

create temp table seed_persons (
  ext text primary key, full_name text, name_known boolean, known_as text, house_name text, gender text,
  birth_year int, birth_date date, is_living boolean, death_year int, native_place text, city text, notes text, pid uuid
) on commit drop;
insert into seed_persons (ext, full_name, name_known, known_as, house_name, gender, birth_year, birth_date, is_living, death_year, native_place, city, notes) values
${personRows.join(',\n')};

create temp table seed_rels (a text, b text, type text, subtype text, status text) on commit drop;
insert into seed_rels values
${relRows.join(',\n')};

insert into families (name) select ${lit(FAMILY_NAME)}
 where not exists (select 1 from families where name = ${lit(FAMILY_NAME)});
insert into sources (family_id, kind, title, details)
select ${fam}, 'spreadsheet', ${lit(SOURCE_TITLE)}, '{"transcribed_by": "seed/transcribe.py"}'
 where not exists (select 1 from sources where family_id = ${fam} and title = ${lit(SOURCE_TITLE)});

-- Reuse the id of anyone loaded before, so a re-run updates instead of duplicating.
update seed_persons s set pid = coalesce(
  (select x.person_id from external_ids x where x.family_id = ${fam} and x.system = '${SYSTEM}' and x.external_id = s.ext),
  gen_random_uuid());

update persons p set full_name = s.full_name, name_known = s.name_known, known_as = s.known_as,
       house_name = s.house_name, gender = s.gender, birth_year = s.birth_year, birth_date = s.birth_date,
       is_living = s.is_living, death_year = s.death_year, native_place = s.native_place, city = s.city, notes = s.notes
  from seed_persons s where p.id = s.pid;
insert into persons (id, family_id, full_name, name_known, known_as, house_name, gender,
                     birth_year, birth_date, is_living, death_year, native_place, city, notes)
select pid, ${fam}, full_name, name_known, known_as, house_name, gender, birth_year, birth_date, is_living, death_year, native_place, city, notes
  from seed_persons s where not exists (select 1 from persons p where p.id = s.pid);
insert into external_ids (family_id, person_id, system, external_id)
select ${fam}, pid, '${SYSTEM}', ext from seed_persons on conflict do nothing;
insert into person_sources (person_id, source_id, family_id, note)
select pid, (select id from sources where family_id = ${fam} and title = ${lit(SOURCE_TITLE)}), ${fam}, notes
  from seed_persons on conflict do nothing;

insert into relationships (family_id, person_a, person_b, type, subtype, status)
select ${fam},
       case when r.type = 'spouse_of' then least(pa.pid, pb.pid) else pa.pid end,
       case when r.type = 'spouse_of' then greatest(pa.pid, pb.pid) else pb.pid end,
       r.type, r.subtype, r.status
  from seed_rels r join seed_persons pa on pa.ext = r.a join seed_persons pb on pb.ext = r.b
on conflict (type, person_a, person_b) do nothing;
${ADMIN_EMAIL && ADMIN_SEED_ID ? `
-- Make ${ADMIN_EMAIL} the admin, linked to their own profile. Create the login first
-- (Authentication → Users → Add user); if it does not exist yet, this step does nothing.
insert into members (family_id, user_id, person_id, role)
select ${fam}, u.id, (select pid from seed_persons where ext = ${lit(ADMIN_SEED_ID)}), 'admin'
  from auth.users u where lower(u.email) = lower(${lit(ADMIN_EMAIL)})
on conflict (family_id, user_id) do update set role = 'admin', person_id = excluded.person_id;
` : ''}
commit;

select (select count(*) from persons where family_id = ${fam}) as people,
       (select count(*) from relationships where family_id = ${fam}) as links,
       (select count(*) from members where family_id = ${fam} and role = 'admin') as admins;
`;
process.stdout.write(sql);

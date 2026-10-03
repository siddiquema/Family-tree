-- Data-integrity rules: impossible data is rejected, unusual-but-real data is accepted.
-- Runs as the database owner (like the server), so access rules are not involved here.
\set QUIET on
set client_min_messages = warning;

create function pg_temp.expect_fail(label text, stmt text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~* pattern then
      raise exception 'FAIL %: wrong error "%"', label, sqlerrm;
    end if;
    raise notice 'ok   %', label;
    return;
  end;
  raise exception 'FAIL %: statement was accepted', label;
end $$;

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok   %', label;
end $$;

set client_min_messages = notice;

insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Test family'),
                                       ('00000000-0000-0000-0000-0000000000f2', 'Other family');
insert into persons (id, family_id, full_name, gender, birth_year, is_living, death_year) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Grandfather', 'male',   1930, false, 1999),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'Grandmother', 'female', 1935, null, null),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f1', 'Father',      'male',   1955, null, null),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', 'Child',       'female', 1980, null, null),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000f1', 'Second wife', 'female', 1960, null, null),
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000f1', 'First wife',  'female', 1957, null, null),
  ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000f1', 'Elder',       'unknown', 1920, null, null),
  ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000f2', 'Outsider',    'male',   1950, null, null);
insert into persons (id, family_id, full_name, name_known) values
  ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000f1', null, false);

insert into relationships (family_id, person_a, person_b, type, subtype) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'parent_of', 'biological');
insert into relationships (family_id, person_a, person_b, type, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'spouse_of', 'widowed');

-- Names
select pg_temp.expect_fail('unknown-name placeholder cannot carry a name',
  $$insert into persons (family_id, full_name, name_known) values ('00000000-0000-0000-0000-0000000000f1', 'X', false)$$,
  'name_known_matches_name');
select pg_temp.expect_fail('a known name cannot be blank',
  $$insert into persons (family_id, full_name) values ('00000000-0000-0000-0000-0000000000f1', '  ')$$,
  'name_known_matches_name');
select pg_temp.ok('placeholder person stored as "name not available"',
  (select not name_known and full_name is null from persons where id = '00000000-0000-0000-0000-000000000007'));

-- Dates
select pg_temp.expect_fail('death before birth',
  $$insert into persons (family_id, full_name, birth_year, is_living, death_year) values ('00000000-0000-0000-0000-0000000000f1', 'X', 1950, false, 1940)$$,
  'death_after_birth');
select pg_temp.expect_fail('death year while marked living',
  $$insert into persons (family_id, full_name, is_living, death_year) values ('00000000-0000-0000-0000-0000000000f1', 'X', true, 1990)$$,
  'death_implies_not_living');
select pg_temp.expect_fail('birth date and year disagree',
  $$insert into persons (family_id, full_name, birth_year, birth_date) values ('00000000-0000-0000-0000-0000000000f1', 'X', 1950, '1951-01-01')$$,
  'birth_date_matches_year');
select pg_temp.expect_fail('birth in the future',
  $$insert into persons (family_id, full_name, birth_year) values ('00000000-0000-0000-0000-0000000000f1', 'X', 2199)$$,
  'future');
select pg_temp.expect_fail('parent born after child',
  $$update persons set birth_year = 1985 where id = '00000000-0000-0000-0000-000000000003'$$,
  'Child .* was born');
select pg_temp.expect_fail('child born before parent',
  $$update persons set birth_year = 1950 where id = '00000000-0000-0000-0000-000000000004'$$,
  'Parent .* was born');

-- Links
select pg_temp.expect_fail('nobody is their own parent',
  $$insert into relationships (family_id, person_a, person_b, type, subtype) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'parent_of', 'biological')$$,
  'no_self_link');
select pg_temp.expect_fail('no ancestry loops',
  $$insert into relationships (family_id, person_a, person_b, type, subtype) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000006', 'parent_of', 'adoptive')$$,
  'Parent .* must be born before|own ancestor');
update persons set birth_year = null where id = '00000000-0000-0000-0000-000000000001';
select pg_temp.expect_fail('no ancestry loops (no dates to help)',
  $$insert into relationships (family_id, person_a, person_b, type, subtype) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'parent_of', 'adoptive')$$,
  'own ancestor');
select pg_temp.expect_fail('a third biological parent',
  $$insert into relationships (family_id, person_a, person_b, type, subtype) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000003', 'parent_of', 'biological')$$,
  'at most two biological parents');
select pg_temp.expect_fail('two biological fathers',
  $$insert into relationships (family_id, person_a, person_b, type, subtype) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'parent_of', 'biological')$$,
  'already has a biological parent who is male');
select pg_temp.expect_fail('parent subtype is required',
  $$insert into relationships (family_id, person_a, person_b, type) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 'parent_of')$$,
  'subtype_only_for_parents');
select pg_temp.expect_fail('spouse pair stored once, in fixed order',
  $$insert into relationships (family_id, person_a, person_b, type, status) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003', 'spouse_of', 'married')$$,
  'spouse_pair_canonical');
select pg_temp.expect_fail('spouses cannot be parent and child',
  $$insert into relationships (family_id, person_a, person_b, type, status) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'spouse_of', 'married')$$,
  'parent and child');
select pg_temp.expect_fail('links never cross families',
  $$insert into relationships (family_id, person_a, person_b, type, subtype) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000004', 'parent_of', 'step')$$,
  'foreign key');

-- Unusual but real: two wives, step parent alongside two biological parents.
insert into relationships (family_id, person_a, person_b, type, status, marriage_order) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005', 'spouse_of', 'married', 2),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'spouse_of', 'married', 1);
insert into relationships (family_id, person_a, person_b, type, subtype) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004', 'parent_of', 'step');
select pg_temp.ok('a man may have two wives; a step parent may sit beside two biological parents',
  (select count(*) = 3 from relationships where person_b = '00000000-0000-0000-0000-000000000004'));

-- Contacts and preferences
select pg_temp.expect_fail('phone must be in +country format',
  $$insert into person_contacts (person_id, family_id, phone) values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', '98400 12345')$$,
  'person_contacts_phone_check');
select pg_temp.expect_fail('cannot be verified without a value',
  $$insert into person_contacts (person_id, family_id, email_verified_at) values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', now())$$,
  'check');

-- Audit
select pg_temp.ok('changes are written to the audit log',
  (select count(*) > 0 from audit_log where target_table = 'persons'));
select pg_temp.expect_fail('audit log cannot be edited',
  $$update audit_log set action = 'x'$$, 'append-only');
select pg_temp.expect_fail('audit log cannot be deleted',
  $$delete from audit_log$$, 'append-only');

-- Seeded reference data and portability
select pg_temp.ok('each new family gets the 40 draft kinship terms, all unverified',
  (select count(*) = 40 and bool_and(not is_verified) from kinship_terms where family_id = '00000000-0000-0000-0000-0000000000f1'));
select pg_temp.expect_fail('kinship path must use the F/M/S/D/B/Z/H/W notation',
  $$insert into kinship_terms (family_id, path, label_en) values ('00000000-0000-0000-0000-0000000000f1', 'F.X', 'bad')$$,
  'kinship_terms_path_check');
select pg_temp.ok('family units: the couple with their shared child',
  (select children = '{00000000-0000-0000-0000-000000000004}' from family_units
    where partner_1 = '00000000-0000-0000-0000-000000000003' and partner_2 = '00000000-0000-0000-0000-000000000006'));
select pg_temp.ok('family units: the second wife has no children with him',
  (select children = '{}' from family_units
    where partner_1 = '00000000-0000-0000-0000-000000000003' and partner_2 = '00000000-0000-0000-0000-000000000005'));
select pg_temp.ok('family units: grandparents with their son',
  (select children = '{00000000-0000-0000-0000-000000000003}' from family_units
    where partner_1 = '00000000-0000-0000-0000-000000000001' and partner_2 = '00000000-0000-0000-0000-000000000002'));
insert into external_ids (family_id, person_id, system, external_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', 'gedcom', '@I4@');
select pg_temp.expect_fail('one local person per remote record',
  $$insert into external_ids (family_id, person_id, system, external_id) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', 'gedcom', '@I4@')$$,
  'duplicate key');
select pg_temp.ok('export holds every person and link',
  (select jsonb_array_length(e -> 'persons') = 8 and jsonb_array_length(e -> 'relationships') = 8
          and jsonb_array_length(e -> 'external_ids') = 1
     from (select export_family('00000000-0000-0000-0000-0000000000f1') e) x));

-- Data-quality report. Impossible data is already blocked by constraints and triggers;
-- this lists things that are allowed but worth a human look.
--   psql "$DATABASE_URL" -X -f scripts/integrity-report.sql
-- Output contains names: view it locally, do not paste it anywhere public.
\pset footer off
\pset null '—'

create temp view _people as
select p.*, coalesce(p.full_name, 'Name not available') as label,
       extract(year from current_date)::int as this_year
  from persons p where p.merged_into is null;

create temp view _parent_child as
select r.person_a as parent_id, par.label as parent, par.gender as parent_gender,
       par.birth_year as parent_born, par.death_year as parent_died,
       r.person_b as child_id, ch.label as child, ch.birth_year as child_born, r.subtype
  from relationships r
  join _people par on par.id = r.person_a
  join _people ch  on ch.id  = r.person_b
 where r.type = 'parent_of';

create temp view _findings as
-- Parents very young or very old at the child's birth
select 'warn' as level, 'parent_age' as check_name, child as person,
       format('%s was %s when %s was born', parent, child_born - parent_born, child) as detail
  from _parent_child
 where subtype = 'biological' and parent_born is not null and child_born is not null
   and (child_born - parent_born < 15
        or (parent_gender = 'female' and child_born - parent_born > 50)
        or child_born - parent_born > 70)
union all
-- Born after a parent had died (allowed for fathers within a year)
select 'warn', 'born_after_parent_died', child,
       format('%s born %s; %s died %s', child, child_born, parent, parent_died)
  from _parent_child
 where subtype = 'biological' and parent_died is not null and child_born is not null
   and child_born > parent_died + case when parent_gender = 'male' then 1 else 0 end
union all
-- Living status
select 'warn', 'probably_deceased', label,
       format('born %s, no death recorded and living status unknown', birth_year)
  from _people where is_living is null and birth_year < this_year - 90
union all
select 'warn', 'living_over_110', label, format('born %s and marked living', birth_year)
  from _people where is_living and birth_year < this_year - 110
union all
-- Isolated records
select 'warn', 'not_linked', label, 'no parent, child or spouse recorded'
  from _people p
 where not exists (select 1 from relationships r where p.id in (r.person_a, r.person_b))
union all
-- Possible duplicates: same name and compatible birth year, not parent and child
select 'info', 'same_name', a.label,
       format('two people named %s (born %s and %s) — duplicate, or a namesake?', a.label,
              coalesce(a.birth_year::text, '?'), coalesce(b.birth_year::text, '?'))
  from _people a join _people b
    on a.family_id = b.family_id and a.id < b.id and lower(a.full_name) = lower(b.full_name)
 where (a.birth_year is null or b.birth_year is null or abs(a.birth_year - b.birth_year) <= 2)
   and not exists (select 1 from relationships r where r.type = 'parent_of'
                    and ((r.person_a = a.id and r.person_b = b.id) or (r.person_a = b.id and r.person_b = a.id)))
union all
-- Marriages
select 'info', 'several_current_spouses', p.label, format('%s marriages recorded as current', count(*))
  from _people p join relationships r on r.type = 'spouse_of' and r.status = 'married' and p.id in (r.person_a, r.person_b)
 group by p.id, p.label having count(*) > 1
union all
select 'info', 'spouse_age_gap', a.label, format('%s and %s: %s years apart', a.label, b.label, abs(a.birth_year - b.birth_year))
  from relationships r join _people a on a.id = r.person_a join _people b on b.id = r.person_b
 where r.type = 'spouse_of' and abs(a.birth_year - b.birth_year) > 20
union all
-- Gaps that limit features
select 'info', 'one_parent_only', label, 'only one parent recorded'
  from _people p
 where (select count(*) from relationships r where r.type = 'parent_of' and r.person_b = p.id) = 1
union all
select 'info', 'name_unknown', label, 'placeholder: name not available' from _people where not name_known
union all
select 'info', 'gender_unknown', label, 'gender not recorded (needed for relationship names)' from _people where gender = 'unknown'
union all
select 'info', 'birth_year_unknown', label, 'birth year not recorded (minor status and elder/younger unknown)'
  from _people where birth_year is null;

\echo
\echo 'Summary'
select level, check_name, count(*) as people
  from _findings group by level, check_name
 order by level desc, count(*) desc;

\echo 'Warnings and duplicates'
select check_name, detail from _findings
 where level = 'warn' or check_name in ('same_name', 'several_current_spouses', 'spouse_age_gap')
 order by check_name, detail;

\echo 'Totals'
select (select count(*) from _people) as people,
       (select count(*) from relationships where type = 'parent_of') as parent_links,
       (select count(*) from relationships where type = 'spouse_of') as marriages,
       (select count(*) from _people where is_living is null) as living_unknown;

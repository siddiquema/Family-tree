-- Portability and connectors.
-- 1. sources / person_sources: where each fact came from (GEDCOM SOUR), so imports can be traced and undone.
-- 2. external_ids: this person's id in another system (GEDCOM xref, FamilySearch, Geni, WikiTree, Family Echo…).
--    Re-imports and future two-way sync match on these instead of on names.
-- 3. export_family(): one self-describing JSON document with everything needed to rebuild the tree elsewhere.

create table public.sources (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  kind         text not null check (kind in ('spreadsheet', 'gedcom', 'member_entry', 'document', 'oral', 'connector')),
  title        text not null,
  details      jsonb not null default '{}',
  imported_at  timestamptz not null default now(),
  unique (id, family_id)
);

create table public.person_sources (
  person_id  uuid not null,
  source_id  uuid not null,
  family_id  uuid not null,
  note       text,
  primary key (person_id, source_id),
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade,
  foreign key (source_id, family_id) references public.sources(id, family_id) on delete cascade
);

create table public.external_ids (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null,
  person_id    uuid not null,
  system       text not null check (system ~ '^[a-z][a-z0-9_]{1,40}$'),  -- e.g. gedcom, familysearch, geni, wikitree, familyecho, seed_xlsx_2011
  external_id  text not null check (length(external_id) between 1 and 200),
  url          text check (url ~ '^https://'),
  synced_at    timestamptz,
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade,
  unique (family_id, system, external_id),   -- one local person per remote record
  unique (person_id, system)                 -- one remote record per system per person
);

grant select on public.sources, public.person_sources, public.external_ids to authenticated;
grant insert, update, delete on public.sources, public.person_sources, public.external_ids to authenticated;
alter table public.sources        enable row level security;
alter table public.person_sources enable row level security;
alter table public.external_ids   enable row level security;
create policy sources_read  on public.sources for select to authenticated using (app.is_member(family_id));
create policy sources_write on public.sources for all    to authenticated using (app.is_admin(family_id)) with check (app.is_admin(family_id));
create policy psources_read  on public.person_sources for select to authenticated using (app.is_member(family_id));
create policy psources_write on public.person_sources for all    to authenticated using (app.is_admin(family_id)) with check (app.is_admin(family_id));
create policy extids_read  on public.external_ids for select to authenticated using (app.is_member(family_id));
create policy extids_write on public.external_ids for all    to authenticated using (app.is_admin(family_id)) with check (app.is_admin(family_id));

-- Full export for backup or migration. Admin-only; contacts are left out on purpose (§4.2):
-- they move only with each person's consent, through a separate path.
create or replace function public.export_family(fid uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null and not app.is_admin(fid) then
    raise exception 'Only an admin can export the family' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'format',        'family-tree-export',
    'format_version', 1,
    'exported_at',   now(),
    'family',        (select to_jsonb(f) from families f where f.id = fid),
    'persons',       coalesce((select jsonb_agg(to_jsonb(p) - 'family_id' order by p.created_at) from persons p where p.family_id = fid), '[]'),
    'relationships', coalesce((select jsonb_agg(to_jsonb(r) - 'family_id') from relationships r where r.family_id = fid), '[]'),
    'education',     coalesce((select jsonb_agg(to_jsonb(e) - 'family_id') from education e where e.family_id = fid), '[]'),
    'work',          coalesce((select jsonb_agg(to_jsonb(w) - 'family_id') from work w where w.family_id = fid), '[]'),
    'photos',        coalesce((select jsonb_agg(to_jsonb(ph) - 'family_id') from photos ph where ph.family_id = fid), '[]'),
    'sources',       coalesce((select jsonb_agg(to_jsonb(s) - 'family_id') from sources s where s.family_id = fid), '[]'),
    'person_sources',coalesce((select jsonb_agg(to_jsonb(ps) - 'family_id') from person_sources ps where ps.family_id = fid), '[]'),
    'external_ids',  coalesce((select jsonb_agg(to_jsonb(x) - 'family_id') from external_ids x where x.family_id = fid), '[]'),
    'kinship_terms', coalesce((select jsonb_agg(to_jsonb(k) - 'family_id') from kinship_terms k where k.family_id = fid), '[]')
  );
end $$;
revoke all on function public.export_family from public, anon;
grant execute on function public.export_family to authenticated;

-- GEDCOM groups people into "family units" (a couple and their children; or one parent and children).
-- This view derives those units from the two stored link types, so a GEDCOM exporter is a formatter only.
create or replace view public.family_units with (security_invoker = true) as
with child_parents as (
  select person_b as child, family_id,
         array_agg(person_a order by person_a) filter (where subtype <> 'step') as parents
    from public.relationships where type = 'parent_of'
   group by person_b, family_id
)
select s.family_id, s.person_a as partner_1, s.person_b as partner_2, s.status, s.start_year, s.end_year,
       coalesce((select array_agg(cp.child) from child_parents cp
                  where cp.parents = array[s.person_a, s.person_b]), '{}') as children
  from public.relationships s where s.type = 'spouse_of'
union all
-- Single parents, and two parents who are not linked as spouses.
select cp.family_id, cp.parents[1], cp.parents[2], null, null, null, array_agg(cp.child)
  from child_parents cp
 where cardinality(cp.parents) in (1, 2)
   and not exists (select 1 from public.relationships s
                    where s.type = 'spouse_of' and cardinality(cp.parents) = 2
                      and s.person_a = cp.parents[1] and s.person_b = cp.parents[2])
 group by cp.family_id, cp.parents;
grant select on public.family_units to authenticated;

-- Supabase grants new tables to anon by default; row-level security would still block it, but be explicit.
revoke all on public.sources, public.person_sources, public.external_ids, public.family_units from anon;

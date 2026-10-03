-- Integrity rules that span rows, so CHECK constraints cannot express them.
-- Hard errors only for things that are impossible. Things that are unusual but real
-- (very young parents, posthumous births, more than one wife) are reported by
-- scripts/integrity-report.sql instead of being blocked.

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger persons_touch before update on public.persons
  for each row execute function app.touch_updated_at();
create trigger person_contacts_touch before update on public.person_contacts
  for each row execute function app.touch_updated_at();
create trigger kinship_terms_touch before update on public.kinship_terms
  for each row execute function app.touch_updated_at();

-- ─── persons ─────────────────────────────────────────────────────────────────
create or replace function app.check_person() returns trigger
language plpgsql as $$
declare
  this_year int := extract(year from now())::int;
  clash record;
begin
  if new.birth_year > this_year or new.death_year > this_year then
    raise exception 'Birth or death year % is in the future', greatest(new.birth_year, new.death_year)
      using errcode = 'check_violation';
  end if;
  if new.birth_date > current_date or new.death_date > current_date then
    raise exception 'Birth or death date is in the future' using errcode = 'check_violation';
  end if;

  -- A changed birth year must still leave every parent older than this person,
  -- and this person older than every child.
  if tg_op = 'UPDATE' and new.birth_year is distinct from old.birth_year and new.birth_year is not null then
    select p.id, p.birth_year into clash
      from public.relationships r join public.persons p on p.id = r.person_a
     where r.type = 'parent_of' and r.person_b = new.id and p.birth_year >= new.birth_year
     limit 1;
    if found then
      raise exception 'Parent % was born in %, not before this person (%)', clash.id, clash.birth_year, new.birth_year
        using errcode = 'check_violation';
    end if;
    select c.id, c.birth_year into clash
      from public.relationships r join public.persons c on c.id = r.person_b
     where r.type = 'parent_of' and r.person_a = new.id and c.birth_year <= new.birth_year
     limit 1;
    if found then
      raise exception 'Child % was born in %, not after this person (%)', clash.id, clash.birth_year, new.birth_year
        using errcode = 'check_violation';
    end if;
  end if;

  -- Biological parents cannot end up with the same known gender.
  if tg_op = 'UPDATE' and new.gender is distinct from old.gender and new.gender <> 'unknown' then
    if exists (
      select 1
        from public.relationships mine
        join public.relationships other
          on other.person_b = mine.person_b and other.type = 'parent_of'
         and other.subtype = 'biological' and other.person_a <> new.id
        join public.persons op on op.id = other.person_a
       where mine.type = 'parent_of' and mine.subtype = 'biological' and mine.person_a = new.id
         and op.gender = new.gender
    ) then
      raise exception 'A child would have two biological parents who are both %', new.gender
        using errcode = 'check_violation';
    end if;
  end if;

  if new.merged_into is not null then
    if exists (select 1 from public.persons where id = new.merged_into and merged_into is not null) then
      raise exception 'Merge into the surviving record, not into one that was itself merged'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger persons_check before insert or update on public.persons
  for each row execute function app.check_person();

-- ─── relationships ───────────────────────────────────────────────────────────
create or replace function app.check_relationship() returns trigger
language plpgsql as $$
declare
  parent public.persons;
  child  public.persons;
begin
  if new.person_a = new.person_b then
    return new;  -- rejected by the no_self_link constraint, which gives the clearer message
  end if;
  if tg_op = 'INSERT' and exists (select 1 from public.relationships
                                   where type = new.type and person_a = new.person_a and person_b = new.person_b) then
    return new;  -- exact duplicate: left to the unique constraint, so ON CONFLICT DO NOTHING works
  end if;
  if new.type = 'parent_of' then
    select * into parent from public.persons where id = new.person_a;
    select * into child  from public.persons where id = new.person_b;

    -- No cycles: the parent must not already be a descendant of the child.
    if exists (
      with recursive descendants(id) as (
        select person_b from public.relationships
         where type = 'parent_of' and person_a = new.person_b and id is distinct from new.id
        union
        select r.person_b from public.relationships r
          join descendants d on r.person_a = d.id
         where r.type = 'parent_of' and r.id is distinct from new.id
      )
      select 1 from descendants where id = new.person_a
    ) then
      raise exception 'This link would make someone their own ancestor' using errcode = 'check_violation';
    end if;

    if parent.birth_year is not null and child.birth_year is not null
       and parent.birth_year >= child.birth_year then
      raise exception 'Parent (born %) must be born before child (born %)', parent.birth_year, child.birth_year
        using errcode = 'check_violation';
    end if;

    if new.subtype = 'biological' then
      if (select count(*) from public.relationships
           where type = 'parent_of' and subtype = 'biological'
             and person_b = new.person_b and id is distinct from new.id) >= 2 then
        raise exception 'A person can have at most two biological parents' using errcode = 'check_violation';
      end if;
      if parent.gender <> 'unknown' and exists (
        select 1 from public.relationships r join public.persons p on p.id = r.person_a
         where r.type = 'parent_of' and r.subtype = 'biological' and r.person_b = new.person_b
           and r.id is distinct from new.id and p.gender = parent.gender
      ) then
        raise exception 'Child already has a biological parent who is %', parent.gender
          using errcode = 'check_violation';
      end if;
    end if;

    if exists (select 1 from public.relationships
                where type = 'spouse_of'
                  and person_a = least(new.person_a, new.person_b)
                  and person_b = greatest(new.person_a, new.person_b)) then
      raise exception 'Spouses cannot also be parent and child' using errcode = 'check_violation';
    end if;

  else  -- spouse_of
    if exists (select 1 from public.relationships
                where type = 'parent_of'
                  and ((person_a = new.person_a and person_b = new.person_b)
                    or (person_a = new.person_b and person_b = new.person_a))) then
      raise exception 'Spouses cannot also be parent and child' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger relationships_check before insert or update on public.relationships
  for each row execute function app.check_relationship();

-- ─── audit_log is append-only ────────────────────────────────────────────────
create or replace function app.block_audit_change() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end $$;

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.block_audit_change();

-- Generic audit trigger. Contact values are never copied into the log, only which fields changed.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rec       jsonb := to_jsonb(coalesce(new, old));
  changed   jsonb := '{}';
  fam       uuid  := (rec ->> 'family_id')::uuid;
  target    uuid;
begin
  target := coalesce(rec ->> 'id', rec ->> 'person_id', rec ->> 'user_id')::uuid;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, case when tg_table_name = 'person_contacts' then to_jsonb('changed'::text) else n.value end), '{}')
      into changed
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at');
  elsif tg_table_name <> 'person_contacts' then
    changed := rec;
  end if;
  insert into public.audit_log (family_id, actor_user_id, action, target_table, target_id, details)
  values (fam, app.current_user_id(), lower(tg_op), tg_table_name, target, changed);
  return null;
end $$;

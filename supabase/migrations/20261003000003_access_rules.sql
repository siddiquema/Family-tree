-- Access rules (CLAUDE.md §4, §5, §5a). Enforced in the database, not the UI.
-- The only Supabase-specific calls are auth.uid() and auth.jwt(), used in app.current_user_id()
-- and app.is_admin(). Swapping auth providers means changing those two functions.

-- ─── Identity helpers ────────────────────────────────────────────────────────
create or replace function app.current_user_id() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_member(fid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from members where family_id = fid and user_id = app.current_user_id())
$$;

create or replace function app.role_in(fid uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from members where family_id = fid and user_id = app.current_user_id()
$$;

-- Admin powers need an MFA session (aal2), as §5a requires MFA for admins.
create or replace function app.is_admin(fid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.role_in(fid) = 'admin' and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function app.my_person(fid uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select person_id from members where family_id = fid and user_id = app.current_user_id()
$$;

create or replace function app.person_of_user(fid uuid, uid uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select person_id from members where family_id = fid and user_id = uid
$$;

-- ─── Family-graph helpers ────────────────────────────────────────────────────
-- Immediate family (§3): parents and children (any subtype), current spouse, and siblings
-- who share a biological or adoptive parent. Step links make a parent, not a sibling.
create or replace function app.is_immediate_family(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select a is not null and b is not null and a <> b and (
    exists (select 1 from relationships
             where type = 'parent_of'
               and ((person_a = a and person_b = b) or (person_a = b and person_b = a)))
    or exists (select 1 from relationships
                where type = 'spouse_of' and status = 'married'
                  and person_a = least(a, b) and person_b = greatest(a, b))
    or exists (select 1 from relationships r1
                 join relationships r2 on r2.person_a = r1.person_a
                where r1.type = 'parent_of' and r2.type = 'parent_of'
                  and r1.subtype <> 'step' and r2.subtype <> 'step'
                  and r1.person_b = a and r2.person_b = b)
  )
$$;

-- Minor = under 18 at read time. Unknown birth year counts as a minor unless the person
-- has died or an admin confirmed they are an adult. Year-only births within the
-- boundary year are treated as minors (could still be 17).
create or replace function app.is_minor(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when p.is_living = false or p.adult_confirmed then false
           when p.birth_date is not null then p.birth_date > current_date - interval '18 years'
           when p.birth_year is not null then extract(year from current_date)::int - p.birth_year <= 18
           else true
         end
    from persons p where p.id = pid
$$;

-- Known minor: birth year or date recorded and under 18. Used for edit rights, where an
-- unknown year (often an ancestor) must not lock the record against the relative who added it.
create or replace function app.is_known_minor(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p.is_living, true) and not p.adult_confirmed and case
           when p.birth_date is not null then p.birth_date > current_date - interval '18 years'
           when p.birth_year is not null then extract(year from current_date)::int - p.birth_year <= 18
           else false
         end
    from persons p where p.id = pid
$$;

-- Direct edit rights (§5): admins; a parent for their child; and, unless the person is a
-- known minor, the person themselves, their spouse, or whoever created the record.
create or replace function app.can_edit_person(pid uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  fam uuid;
  creator uuid;
  me uuid;
begin
  select family_id, created_by into fam, creator from persons where id = pid;
  if fam is null or not app.is_member(fam) then return false; end if;
  if app.is_admin(fam) then return true; end if;
  me := app.my_person(fam);
  if me is not null and exists (select 1 from relationships
                                 where type = 'parent_of' and person_a = me and person_b = pid) then
    return true;
  end if;
  if app.is_known_minor(pid) then return false; end if;
  return pid = me
      or creator = app.current_user_id()
      or (me is not null and exists (select 1 from relationships
                                      where type = 'spouse_of' and status = 'married'
                                        and person_a = least(me, pid) and person_b = greatest(me, pid)));
end $$;

-- ─── Guards on fields only admins (or the server) may set ────────────────────
create or replace function app.guard_person() returns trigger
language plpgsql as $$
begin
  if app.current_user_id() is null then return new; end if;  -- server-side (service role) writes
  if tg_op = 'UPDATE' and new.family_id <> old.family_id then
    raise exception 'A person cannot move to another family' using errcode = 'insufficient_privilege';
  end if;
  if not app.is_admin(new.family_id) then
    if (tg_op = 'INSERT' and (new.adult_confirmed or new.merged_into is not null))
       or (tg_op = 'UPDATE' and (new.adult_confirmed is distinct from old.adult_confirmed
                                 or new.merged_into is distinct from old.merged_into)) then
      raise exception 'Only an admin can confirm adulthood or merge records' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
create trigger persons_guard before insert or update on public.persons
  for each row execute function app.guard_person();

create or replace function app.guard_member() returns trigger
language plpgsql as $$
begin
  if tg_op <> 'DELETE' and app.current_user_id() is not null and not app.is_admin(new.family_id)
     and (new.role, new.email_exempt, new.email_exempt_by, new.email_exempt_reason, new.email_exempt_at, new.person_id)
         is distinct from (old.role, old.email_exempt, old.email_exempt_by, old.email_exempt_reason, old.email_exempt_at, old.person_id) then
    raise exception 'Only an admin can change roles or email exemption' using errcode = 'insufficient_privilege';
  end if;
  -- Every family keeps at least one admin.
  if (tg_op = 'DELETE' or new.role <> 'admin') and old.role = 'admin'
     and not exists (select 1 from public.members
                      where family_id = old.family_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'A family must keep at least one admin' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger members_guard before update or delete on public.members
  for each row execute function app.guard_member();

-- ─── Audit trail ─────────────────────────────────────────────────────────────
create trigger audit_persons        after insert or update or delete on public.persons             for each row execute function app.audit_row();
create trigger audit_relationships  after insert or update or delete on public.relationships       for each row execute function app.audit_row();
create trigger audit_contacts       after insert or update or delete on public.person_contacts     for each row execute function app.audit_row();
create trigger audit_members        after insert or update or delete on public.members             for each row execute function app.audit_row();
create trigger audit_invites        after insert or update or delete on public.invites             for each row execute function app.audit_row();
create trigger audit_recovery       after insert or update or delete on public.recovery_requests   for each row execute function app.audit_row();
create trigger audit_edit_requests  after insert or update or delete on public.edit_requests       for each row execute function app.audit_row();
create trigger audit_announcements  after insert or update or delete on public.announcements       for each row execute function app.audit_row();
create trigger audit_kinship_terms  after insert or update or delete on public.kinship_terms       for each row execute function app.audit_row();

-- ─── Privileges ──────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

grant select, update (name) on public.families to authenticated;
grant select, insert, update, delete on
  public.persons, public.relationships, public.education, public.work, public.photos,
  public.edit_requests, public.announcements, public.announcement_subjects,
  public.notification_prefs, public.kinship_terms to authenticated;
grant select, delete, update (role, email_exempt, email_exempt_by, email_exempt_reason, email_exempt_at, ui_language)
  on public.members to authenticated;
grant select, update (phone_hidden, has_whatsapp) on public.person_contacts to authenticated;
grant select, insert, delete on public.invites to authenticated;
grant select on public.recovery_requests, public.kinship_missing, public.audit_log to authenticated;
grant select, update (read_at) on public.announcement_recipients to authenticated;

-- ─── Row-level security ──────────────────────────────────────────────────────
alter table public.families                enable row level security;
alter table public.persons                 enable row level security;
alter table public.person_contacts         enable row level security;
alter table public.relationships           enable row level security;
alter table public.education               enable row level security;
alter table public.work                    enable row level security;
alter table public.photos                  enable row level security;
alter table public.members                 enable row level security;
alter table public.invites                 enable row level security;
alter table public.recovery_requests       enable row level security;
alter table public.edit_requests           enable row level security;
alter table public.announcements           enable row level security;
alter table public.announcement_subjects   enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.notification_prefs      enable row level security;
alter table public.kinship_terms           enable row level security;
alter table public.kinship_missing         enable row level security;
alter table public.audit_log               enable row level security;

create policy families_read   on public.families for select to authenticated using (app.is_member(id));
create policy families_update on public.families for update to authenticated using (app.is_admin(id)) with check (app.is_admin(id));

-- People: every logged-in member of the family can read; nobody outside can (§4.5).
create policy persons_read   on public.persons for select to authenticated using (app.is_member(family_id));
create policy persons_insert on public.persons for insert to authenticated
  with check (app.is_member(family_id) and created_by = app.current_user_id());
create policy persons_update on public.persons for update to authenticated
  using (app.can_edit_person(id)) with check (app.can_edit_person(id));
create policy persons_delete on public.persons for delete to authenticated using (app.is_admin(family_id));

-- Contacts: the person and their immediate family only. Admins have no access (§4.2).
create policy contacts_read on public.person_contacts for select to authenticated using (
  person_id = app.my_person(family_id)
  or (not phone_hidden and app.is_immediate_family(app.my_person(family_id), person_id)));
create policy contacts_update_own on public.person_contacts for update to authenticated
  using (person_id = app.my_person(family_id)) with check (person_id = app.my_person(family_id));

-- Links. A parent link needs edit rights on the child, or is "add my child" for a record
-- I just created. A spouse link needs edit rights on both people.
create policy rel_read on public.relationships for select to authenticated using (app.is_member(family_id));
create policy rel_insert on public.relationships for insert to authenticated with check (
  app.is_member(family_id) and created_by = app.current_user_id() and (
    (type = 'parent_of' and (app.can_edit_person(person_b)
       or (person_a = app.my_person(family_id)
           and exists (select 1 from public.persons c where c.id = person_b and c.created_by = app.current_user_id()))))
    or (type = 'spouse_of' and app.can_edit_person(person_a) and app.can_edit_person(person_b))));
create policy rel_update on public.relationships for update to authenticated
  using ((type = 'parent_of' and app.can_edit_person(person_b))
      or (type = 'spouse_of' and app.can_edit_person(person_a) and app.can_edit_person(person_b)))
  with check ((type = 'parent_of' and app.can_edit_person(person_b))
      or (type = 'spouse_of' and app.can_edit_person(person_a) and app.can_edit_person(person_b)));
create policy rel_delete on public.relationships for delete to authenticated
  using ((type = 'parent_of' and app.can_edit_person(person_b))
      or (type = 'spouse_of' and app.can_edit_person(person_a) and app.can_edit_person(person_b)));

create policy edu_read  on public.education for select to authenticated using (app.is_member(family_id));
create policy edu_write on public.education for all    to authenticated
  using (app.can_edit_person(person_id)) with check (app.can_edit_person(person_id));
create policy work_read  on public.work for select to authenticated using (app.is_member(family_id));
create policy work_write on public.work for all    to authenticated
  using (app.can_edit_person(person_id)) with check (app.can_edit_person(person_id));
create policy photos_read  on public.photos for select to authenticated using (app.is_member(family_id));
create policy photos_write on public.photos for all    to authenticated
  using (app.can_edit_person(person_id))
  with check (app.can_edit_person(person_id) and uploaded_by = app.current_user_id());

-- Members: you see your own row; admins see everyone (exemption reasons are admin-only).
create policy members_read   on public.members for select to authenticated
  using (user_id = app.current_user_id() or app.is_admin(family_id));
create policy members_update on public.members for update to authenticated
  using (user_id = app.current_user_id() or app.is_admin(family_id))
  with check (user_id = app.current_user_id() or app.is_admin(family_id));
create policy members_delete on public.members for delete to authenticated using (app.is_admin(family_id));

-- Invites: admins and branch owners; only admins may pre-set an email exemption.
create policy invites_read on public.invites for select to authenticated
  using (app.is_admin(family_id) or app.role_in(family_id) = 'branch_owner');
create policy invites_insert on public.invites for insert to authenticated with check (
  created_by = app.current_user_id() and used_at is null
  and (app.is_admin(family_id) or (app.role_in(family_id) = 'branch_owner' and not email_exempt)));
create policy invites_delete on public.invites for delete to authenticated
  using (app.is_admin(family_id) or created_by = app.current_user_id());

-- Recovery: rows are written only through the functions below; people involved can read.
-- The target's immediate family can see the request too, so a second relative can confirm it.
create policy recovery_read on public.recovery_requests for select to authenticated using (
  authorised_by = app.current_user_id() or second_authoriser = app.current_user_id() or app.is_admin(family_id)
  or app.is_immediate_family(app.my_person(family_id), app.person_of_user(family_id, target_user_id)));

-- Edit requests: the submitter and anyone who could make the edit directly.
create policy edits_read on public.edit_requests for select to authenticated
  using (submitted_by = app.current_user_id() or app.can_edit_person(target_person_id));
create policy edits_insert on public.edit_requests for insert to authenticated with check (
  app.is_member(family_id) and submitted_by = app.current_user_id() and status = 'pending');
create policy edits_review on public.edit_requests for update to authenticated
  using (app.can_edit_person(target_person_id) and submitted_by <> app.current_user_id())
  with check (reviewed_by = app.current_user_id());

-- Announcements: drafts by any member; sending is done by the server (service role) only.
-- The two helpers keep the announcements and recipients policies from referring to each other.
create or replace function app.is_recipient(aid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from announcement_recipients where announcement_id = aid and user_id = app.current_user_id())
$$;
create or replace function app.announcement_author(aid uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select created_by from announcements where id = aid
$$;
grant execute on function app.is_recipient, app.announcement_author to authenticated;
create policy ann_read on public.announcements for select to authenticated using (
  created_by = app.current_user_id() or app.is_admin(family_id)
  or (status = 'sent' and app.is_member(family_id)
      and (audience = 'all' or app.is_recipient(id))));
create policy ann_insert on public.announcements for insert to authenticated with check (
  app.is_member(family_id) and created_by = app.current_user_id()
  and status in ('draft', 'pending_approval') and approved_by is null);
create policy ann_update on public.announcements for update to authenticated
  using ((created_by = app.current_user_id() and status in ('draft', 'pending_approval')) or app.is_admin(family_id))
  with check (status <> 'sent' and (approved_by is null or (approved_by = app.current_user_id() and app.is_admin(family_id))));
create policy ann_subjects_read on public.announcement_subjects for select to authenticated
  using (exists (select 1 from public.announcements a where a.id = announcement_id));
create policy ann_subjects_write on public.announcement_subjects for all to authenticated
  using (exists (select 1 from public.announcements a where a.id = announcement_id
                  and a.created_by = app.current_user_id() and a.status in ('draft', 'pending_approval')))
  with check (exists (select 1 from public.announcements a where a.id = announcement_id
                  and a.created_by = app.current_user_id() and a.status in ('draft', 'pending_approval')));
create policy ann_recipients_read on public.announcement_recipients for select to authenticated using (
  user_id = app.current_user_id() or app.is_admin(family_id)
  or app.announcement_author(announcement_id) = app.current_user_id());
create policy ann_recipients_mark_read on public.announcement_recipients for update to authenticated
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy prefs_own on public.notification_prefs for all to authenticated
  using (user_id = app.current_user_id() and app.is_member(family_id))
  with check (user_id = app.current_user_id() and app.is_member(family_id));

create policy kin_read  on public.kinship_terms for select to authenticated using (app.is_member(family_id));
create policy kin_write on public.kinship_terms for all    to authenticated
  using (app.is_admin(family_id)) with check (app.is_admin(family_id));
create policy kin_missing_read on public.kinship_missing for select to authenticated using (app.is_admin(family_id));

create policy audit_read on public.audit_log for select to authenticated using (app.is_admin(family_id));

-- ─── RPCs (called from the app; checks run inside) ───────────────────────────
-- Step 1 of recovery: an immediate-family relative asks for a reset.
create or replace function public.request_recovery(fid uuid, target uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_person uuid;
  rid uuid;
begin
  select person_id into target_person from members where family_id = fid and user_id = target;
  if target_person is null or not app.is_immediate_family(app.my_person(fid), target_person) then
    raise exception 'Only an immediate-family member can start a reset' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from recovery_requests
       where target_user_id = target and created_at > now() - interval '30 days') >= 3 then
    raise exception 'This person has had 3 resets in the last 30 days' using errcode = 'check_violation';
  end if;
  insert into recovery_requests (family_id, target_user_id, authorised_by)
  values (fid, target, app.current_user_id()) returning id into rid;
  return rid;
end $$;

-- Extra step for email-exempt members: a second, different relative confirms.
create or replace function public.confirm_recovery(rid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r recovery_requests;
  target_person uuid;
begin
  select * into r from recovery_requests where id = rid and status = 'authorised' and expires_at > now() for update;
  if not found then raise exception 'No open reset request' using errcode = 'no_data_found'; end if;
  select person_id into target_person from members where family_id = r.family_id and user_id = r.target_user_id;
  if app.current_user_id() in (r.target_user_id, r.authorised_by)
     or not app.is_immediate_family(app.my_person(r.family_id), target_person) then
    raise exception 'A second, different immediate-family member must confirm' using errcode = 'insufficient_privilege';
  end if;
  update recovery_requests set second_authoriser = app.current_user_id() where id = rid;
end $$;

-- Step 2: an admin (not the target) approves. Codes and the new password are handled by an Edge Function.
create or replace function public.approve_recovery(rid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r recovery_requests;
  exempt boolean;
begin
  select * into r from recovery_requests where id = rid and status = 'authorised' and expires_at > now() for update;
  if not found then raise exception 'No open reset request' using errcode = 'no_data_found'; end if;
  if not app.is_admin(r.family_id) or app.current_user_id() = r.target_user_id then
    raise exception 'Another admin must approve this reset' using errcode = 'insufficient_privilege';
  end if;
  select email_exempt into exempt from members where family_id = r.family_id and user_id = r.target_user_id;
  if exempt and r.second_authoriser is null then
    raise exception 'This member has no email, so a second relative must confirm first' using errcode = 'check_violation';
  end if;
  update recovery_requests set status = 'approved', approved_by = app.current_user_id() where id = rid;
end $$;

-- Who to ask for a phone number: claimed relatives who can see it (§4.2).
create or replace function public.contact_holders(pid uuid) returns table (person_id uuid, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.full_name
    from persons t
    join members m on m.family_id = t.family_id
    join persons p on p.id = m.person_id
   where t.id = pid and app.is_member(t.family_id) and app.is_immediate_family(p.id, t.id)
$$;

-- Record a relationship path the calculator could not name, for the admin "missing terms" list.
create or replace function public.record_missing_kinship(fid uuid, kin_path text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into kinship_missing (family_id, path)
  select fid, kin_path where app.is_member(fid)
  on conflict (family_id, path) do update set lookups = kinship_missing.lookups + 1, last_seen = now()
$$;

revoke all on function public.request_recovery, public.confirm_recovery, public.approve_recovery,
  public.contact_holders, public.record_missing_kinship from public, anon;
grant execute on function public.request_recovery, public.confirm_recovery, public.approve_recovery,
  public.contact_holders, public.record_missing_kinship to authenticated;

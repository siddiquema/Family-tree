-- admin_link_member() never touched the invites table, so a relative linked this way (instead
-- of via redeem_invite()) left their original invite sitting in "Pending" forever, with an
-- active Revoke button, even though they're already a member — confusing, though harmless
-- (revoking it wouldn't undo their membership). Close out the matching invite when there is one.
create or replace function public.admin_link_member(fid uuid, p_email text, p_person_id uuid default null, p_role text default 'member')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_user uuid;
  target_person uuid;
begin
  if not app.is_admin(fid) then
    raise exception 'Only an admin can link a login to a profile' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('member', 'branch_owner') then
    raise exception 'Use the admin bootstrap script to grant the admin role' using errcode = 'check_violation';
  end if;

  select id into target_user from auth.users where lower(email) = lower(p_email);
  if target_user is null then
    raise exception 'No login found for that email — ask them to try the invite link at least once first' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from members where family_id = fid and user_id = target_user) then
    raise exception 'This login is already a member of this family' using errcode = 'unique_violation';
  end if;

  target_person := p_person_id;
  if target_person is not null and exists (select 1 from members where family_id = fid and person_id = target_person) then
    raise exception 'Someone has already claimed this profile' using errcode = 'unique_violation';
  end if;
  if target_person is null then
    insert into persons (family_id, name_known, created_by)
    values (fid, false, app.current_user_id())
    returning id into target_person;
  end if;

  insert into members (family_id, user_id, person_id, role) values (fid, target_user, target_person, p_role);

  if p_person_id is not null then
    update invites set used_at = now(), used_by = target_user
      where family_id = fid and person_id = p_person_id and used_at is null;
  end if;

  return target_person;
end $$;

revoke all on function public.admin_link_member from public, anon;
grant execute on function public.admin_link_member to authenticated;

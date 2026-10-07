-- Redeems an invite (§5a): called once the caller already has a session with a verified email
-- (the app gets that for free via Supabase Auth's own email-OTP sign-in, before this runs).
--
-- Phone OTP is not wired up yet — Twilio + India DLT registration is a paid step CLAUDE.md
-- §2/§5a flags as needing Siddique's sign-off first. Until then this records the phone number
-- the member typed (person_contacts.phone) but leaves phone_verified_at null, so the gap is
-- visible in the data rather than papered over. email_exempt is NOT set here: that flag means
-- "no email, phone-only", the opposite of this situation, and must stay reserved for it.
--
-- The raw token (from the invite link) is hashed here with the same sha256() the admin's
-- invite-creation insert uses, so only the hash is ever compared — the raw value is never
-- stored (per §3) and this is the only place it's checked against what is stored.
create or replace function public.redeem_invite(p_token text, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv invites;
  target_person uuid;
  caller_email text := auth.jwt() ->> 'email';
begin
  select * into inv from invites
   where token_hash = sha256(convert_to(p_token, 'UTF8')) and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'This invite link is invalid, already used, or has expired' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from members where family_id = inv.family_id and user_id = app.current_user_id()) then
    raise exception 'This login is already a member of this family' using errcode = 'unique_violation';
  end if;

  target_person := inv.person_id;
  if target_person is not null
     and exists (select 1 from members where family_id = inv.family_id and person_id = target_person) then
    raise exception 'Someone has already claimed this profile' using errcode = 'unique_violation';
  end if;
  if target_person is null then
    insert into persons (family_id, name_known, created_by)
    values (inv.family_id, false, app.current_user_id())
    returning id into target_person;
  end if;

  insert into members (family_id, user_id, person_id, role)
  values (inv.family_id, app.current_user_id(), target_person, 'member');

  insert into person_contacts (person_id, family_id, email, email_verified_at, phone)
  values (target_person, inv.family_id, caller_email, case when caller_email is not null then now() end, p_phone)
  on conflict (person_id) do update
    set email = excluded.email, email_verified_at = excluded.email_verified_at,
        phone = coalesce(excluded.phone, person_contacts.phone);

  update invites set used_at = now(), used_by = app.current_user_id() where id = inv.id;

  return target_person;
end $$;

revoke all on function public.redeem_invite from public, anon;
grant execute on function public.redeem_invite to authenticated;

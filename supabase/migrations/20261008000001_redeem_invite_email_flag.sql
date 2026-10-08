-- TEMPORARY (08 Oct 26): Supabase's built-in email sender is too rate-limited for real use
-- ("email rate limit exceeded" hit during actual testing — CLAUDE.md §2), and a replacement
-- SMTP provider isn't configured yet. Until then, the app creates new members with
-- supabase.auth.signUp() directly instead of the email-OTP flow, so there's no proof the
-- caller's JWT email claim is really theirs. redeem_invite() now takes an explicit flag for
-- that instead of always assuming OTP already verified it; the join.js caller passes false
-- while this is in effect. Revert by going back to the OTP calls in src/data/store.js
-- (joinSendCode/joinVerifyCode, left in place unused) — this flag can stay, defaulting to
-- true, for whenever that path is used again.
drop function if exists public.redeem_invite(text, text);

create or replace function public.redeem_invite(p_token text, p_phone text default null, p_email_verified boolean default true)
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
  values (target_person, inv.family_id, caller_email,
          case when caller_email is not null and p_email_verified then now() end, p_phone)
  on conflict (person_id) do update
    set email = excluded.email, email_verified_at = excluded.email_verified_at,
        phone = coalesce(excluded.phone, person_contacts.phone);

  update invites set used_at = now(), used_by = app.current_user_id() where id = inv.id;

  return target_person;
end $$;

revoke all on function public.redeem_invite from public, anon;
grant execute on function public.redeem_invite to authenticated;

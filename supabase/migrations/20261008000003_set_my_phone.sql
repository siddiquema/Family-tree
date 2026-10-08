-- Lets a member set or clear their own phone number. Direct UPDATEs on
-- person_contacts.phone are blocked by the column grant in access_rules.sql
-- (members only ever got `update (phone_hidden, has_whatsapp)` — changing a
-- *verified* phone needs OTP on the old and new number per §5a, but phone
-- OTP isn't built yet, so there was no column grant for `phone` at all,
-- which meant nobody — verified or not — could set one). This bypasses that
-- gap the same deliberate way as join.js: it always leaves
-- phone_verified_at null, so the gap stays visible in the data rather than
-- being papered over with a fake verification timestamp.
create or replace function public.set_my_phone(fid uuid, p_phone text, p_hidden boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid;
begin
  me := app.my_person(fid);
  if me is null then
    raise exception 'You are not a member of this family' using errcode = 'insufficient_privilege';
  end if;

  insert into public.person_contacts (person_id, family_id, phone, phone_hidden)
  values (me, fid, nullif(trim(p_phone), ''), coalesce(p_hidden, false))
  on conflict (person_id) do update
    set phone = excluded.phone, phone_hidden = excluded.phone_hidden, phone_verified_at = null;
end $$;

revoke all on function public.set_my_phone from public, anon;
grant execute on function public.set_my_phone to authenticated;

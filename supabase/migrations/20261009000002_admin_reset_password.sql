-- Deliberate, temporary bypass of the full §5a recovery flow (relative authorises, a SECOND,
-- different admin approves, OTP on both channels, new password set). That flow needs two
-- different admins and currently there's only one in this family, so it's structurally stuck.
-- This lets any admin set a one-time password for a member directly — same spirit as the
-- no-OTP joinSimple() flow elsewhere: a flagged, visible gap instead of a silent dead end.
-- The admin must then tell the member the temporary password through a channel they already
-- trust (a phone call, in person); nothing here emails or SMSs it. Every existing session for
-- that login is revoked, same as real recovery, so a lost device can't keep using the old one.
create extension if not exists pgcrypto;

create or replace function public.admin_reset_password(fid uuid, target_user_id uuid, new_password text)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not app.is_admin(fid) then
    raise exception 'Only an admin can reset a password' using errcode = 'insufficient_privilege';
  end if;
  if length(new_password) < 12 then
    raise exception 'Password must be at least 12 characters' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from members where family_id = fid and user_id = target_user_id) then
    raise exception 'That login is not a member of this family' using errcode = 'no_data_found';
  end if;

  update auth.users set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now()
    where id = target_user_id;
  delete from auth.sessions where user_id = target_user_id;
end $$;

revoke all on function public.admin_reset_password from public, anon;
grant execute on function public.admin_reset_password to authenticated;

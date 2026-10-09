-- Temporary admin-set-password bypass (§5a note) — see
-- supabase/migrations/20261009000002_admin_reset_password.sql.
set client_min_messages = warning;

create function pg_temp.expect_fail(label text, stmt text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~* pattern then raise exception 'FAIL %: wrong error "%"', label, sqlerrm; end if;
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
create function pg_temp.login(uid text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal)::text, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;
set client_min_messages = notice;

insert into auth.users (id, encrypted_password) values
  ('00000000-0000-0000-0000-0000000000a1', 'old-hash-a'), -- admin
  ('00000000-0000-0000-0000-0000000000b1', 'old-hash-b'), -- member
  ('00000000-0000-0000-0000-0000000000c1', 'old-hash-c'); -- not a member of this family
insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Family one');
insert into persons (id, family_id, full_name, gender) values
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000f1', 'Admin person', 'female'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000f1', 'Member person', 'male');
insert into members (family_id, user_id, person_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000106', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000107', 'member');
insert into auth.sessions (user_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b1');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail('a non-admin cannot reset anyone''s password',
  $$select admin_reset_password('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'a-new-password-123')$$,
  'Only an admin');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select pg_temp.expect_fail('an admin without authenticator sign-in cannot reset one either',
  $$select admin_reset_password('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'a-new-password-123')$$,
  'Only an admin');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.expect_fail('too-short password is rejected, same 12-char minimum as everywhere else',
  $$select admin_reset_password('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'short')$$,
  '12 characters');
select pg_temp.expect_fail('cannot reset a login that is not a member of this family',
  $$select admin_reset_password('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'a-new-password-123')$$,
  'not a member');

select admin_reset_password('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'a-new-password-123');
select pg_temp.logout();
select pg_temp.ok('the password hash changed',
  (select encrypted_password <> 'old-hash-b' from auth.users where id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.ok('every existing session for that login was revoked',
  (select count(*) = 0 from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b1'));

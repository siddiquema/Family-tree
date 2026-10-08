-- The admin recovery tool for a login stuck mid-join (§5a) — see
-- supabase/migrations/20261008000002_admin_link_member.sql.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'member@example.com'),  -- already a member
  ('00000000-0000-0000-0000-0000000000c1', 'stuck@example.com');   -- signed up, never linked
insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Family one');
insert into persons (id, family_id, full_name, gender) values
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000f1', 'Admin person', 'female'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000f1', 'Existing member person', 'female'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-0000000000f1', 'Stuck relative', 'female'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-0000000000f1', 'Already claimed', 'male');
insert into members (family_id, user_id, person_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000106', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000107', 'member');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail('a non-admin cannot link anyone',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'stuck@example.com', '00000000-0000-0000-0000-000000000108')$$,
  'Only an admin');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select pg_temp.expect_fail('an admin without authenticator sign-in cannot link anyone either',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'stuck@example.com', '00000000-0000-0000-0000-000000000108')$$,
  'Only an admin');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.expect_fail('no login exists for that email',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'nobody@example.com', '00000000-0000-0000-0000-000000000108')$$,
  'No login found');
select pg_temp.expect_fail('cannot link someone already a member',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'member@example.com', '00000000-0000-0000-0000-000000000108')$$,
  'already a member');
select pg_temp.expect_fail('cannot link onto a profile someone else already claimed',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'stuck@example.com', '00000000-0000-0000-0000-000000000107')$$,
  'already claimed');
select pg_temp.expect_fail('cannot grant the admin role through this tool',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'stuck@example.com', '00000000-0000-0000-0000-000000000108', 'admin')$$,
  'bootstrap script');

select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'STUCK@EXAMPLE.COM', '00000000-0000-0000-0000-000000000108');
select pg_temp.ok('the stuck login is now a member, matched case-insensitively, linked to the right person',
  (select person_id = '00000000-0000-0000-0000-000000000108' and role = 'member' from members
    where family_id = '00000000-0000-0000-0000-0000000000f1' and user_id = '00000000-0000-0000-0000-0000000000c1'));
select pg_temp.expect_fail('cannot link the same login twice',
  $$select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'stuck@example.com', '00000000-0000-0000-0000-000000000109')$$,
  'already a member');
select pg_temp.logout();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'stuck-no-profile@example.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select admin_link_member('00000000-0000-0000-0000-0000000000f1', 'stuck-no-profile@example.com');
select pg_temp.ok('no person_id creates a new placeholder person, same as redeem_invite',
  (select count(*) = 1 from persons p join members m on m.person_id = p.id
    where m.user_id = '00000000-0000-0000-0000-0000000000d1' and p.name_known = false));
select pg_temp.logout();

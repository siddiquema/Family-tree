-- A member setting their own phone number (§3 person_contacts) — see
-- supabase/migrations/20261008000003_set_my_phone.sql.
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

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), -- A
  ('00000000-0000-0000-0000-0000000000b1'); -- B
insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Family one');
insert into persons (id, family_id, full_name, gender) values
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000f1', 'Person A', 'female'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000f1', 'Person B', 'male');
insert into members (family_id, user_id, person_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000106', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000107', 'member');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_my_phone('00000000-0000-0000-0000-0000000000f1', '+919800000001', false);
select pg_temp.ok('A can set their own phone',
  (select phone = '+919800000001' and not phone_hidden and phone_verified_at is null
    from person_contacts where person_id = '00000000-0000-0000-0000-000000000106'));
select pg_temp.expect_fail('A still cannot set the phone column by a direct update',
  $$update person_contacts set phone = '+919800000009' where person_id = '00000000-0000-0000-0000-000000000106'$$,
  'permission denied');

select set_my_phone('00000000-0000-0000-0000-0000000000f1', '+919800000001', true);
select pg_temp.ok('A can re-set the same number as hidden',
  (select phone_hidden from person_contacts where person_id = '00000000-0000-0000-0000-000000000106'));

select pg_temp.expect_fail('an invalid phone is rejected by the same format check as everywhere else',
  $$select set_my_phone('00000000-0000-0000-0000-0000000000f1', '12345', false)$$,
  'violates check constraint');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail('B cannot take a number already in use by A',
  $$select set_my_phone('00000000-0000-0000-0000-0000000000f1', '+919800000001', false)$$,
  'duplicate key|unique');
select set_my_phone('00000000-0000-0000-0000-0000000000f1', '+919800000002', false);
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_my_phone('00000000-0000-0000-0000-0000000000f1', '  ', false);
select pg_temp.ok('an empty string clears the phone',
  (select phone is null from person_contacts where person_id = '00000000-0000-0000-0000-000000000106'));
select pg_temp.logout();

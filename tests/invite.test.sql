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
create function pg_temp.login(uid text, email text default null, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal, 'email', email)::text, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;
set client_min_messages = notice;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), -- admin
  ('00000000-0000-0000-0000-0000000000b1'), -- new relative, claiming an existing unclaimed person
  ('00000000-0000-0000-0000-0000000000c1'), -- new relative, no person_id on invite (creates a new person)
  ('00000000-0000-0000-0000-0000000000d1'); -- tries to reuse a used invite
insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Family one');
insert into persons (id, family_id, full_name, gender, birth_year) values
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000f1', 'Admin person', 'female', 1975),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000f1', 'Unclaimed relative', 'male', 1960);
insert into members (family_id, user_id, person_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000106', 'admin');

-- Admin creates two invites: one linked to an existing unclaimed person, one blank.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', null, 'aal2');
insert into invites (id, family_id, token_hash, person_id, created_by, expires_at, created_at) values
  ('00000000-0000-0000-0000-000000000900', '00000000-0000-0000-0000-0000000000f1', sha256(convert_to('tok-claim-existing', 'UTF8')), '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000a1', now() + interval '7 days', now()),
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-0000000000f1', sha256(convert_to('tok-new-person', 'UTF8')), null, '00000000-0000-0000-0000-0000000000a1', now() + interval '7 days', now()),
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-0000000000f1', sha256(convert_to('tok-expired', 'UTF8')), null, '00000000-0000-0000-0000-0000000000a1', now() - interval '3 days', now() - interval '10 days');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1', 'b@example.com');
select pg_temp.expect_fail('a wrong token is rejected',
  $$select redeem_invite('not-the-real-token', '+919800000011')$$, 'invalid, already used, or has expired');
select pg_temp.expect_fail('an expired invite is rejected',
  $$select redeem_invite('tok-expired', '+919800000011')$$, 'invalid, already used, or has expired');
select redeem_invite('tok-claim-existing', '+919800000011');
select pg_temp.ok('redeeming links the login to the existing person',
  (select person_id = '00000000-0000-0000-0000-000000000110' from members
    where family_id = '00000000-0000-0000-0000-0000000000f1' and user_id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.ok('the new member defaults to role member', (select role = 'member' from members
    where user_id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.ok('the verified email from the JWT was recorded with a verified timestamp',
  (select email = 'b@example.com' and email_verified_at is not null from person_contacts
    where person_id = '00000000-0000-0000-0000-000000000110'));
select pg_temp.ok('the phone was recorded but NOT marked verified (no SMS OTP yet)',
  (select phone = '+919800000011' and phone_verified_at is null from person_contacts
    where person_id = '00000000-0000-0000-0000-000000000110'));
select pg_temp.ok('email_exempt stays false: this member has a verified email', (select email_exempt = false from members
    where user_id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.expect_fail('the same invite cannot be redeemed twice',
  $$select redeem_invite('tok-claim-existing', '+919800000099')$$, 'invalid, already used, or has expired');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000c1', 'c@example.com');
select redeem_invite('tok-new-person', null);
select pg_temp.ok('an invite with no person_id creates a brand new placeholder person',
  (select count(*) = 1 from persons p join members m on m.person_id = p.id
    where m.user_id = '00000000-0000-0000-0000-0000000000c1' and p.name_known = false));
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1', null, 'aal2');
select pg_temp.ok('the admin can see both invites are now used',
  (select count(*) = 2 from invites where used_at is not null));
select pg_temp.logout();

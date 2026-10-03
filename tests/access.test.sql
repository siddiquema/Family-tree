-- Access rules (CLAUDE.md §4, §5, §5a), tested as the real "authenticated" and "anon" roles.
-- Cast: grandfather → father C and uncle U; C's children B and S; U's child D (B's cousin);
-- B's young child K; admin A (unrelated in-law); E belongs to a different family.
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
create function pg_temp.rows(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'with x as (' || stmt || ') select count(*) from x' into n;
  return n;
end $$;
create function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
-- Become a logged-in user. aal2 = signed in with an authenticator app.
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

-- ─── Fixture (as the server) ─────────────────────────────────────────────────
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000f9');
insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Family one'),
                                       ('00000000-0000-0000-0000-0000000000f2', 'Family two');
insert into persons (id, family_id, full_name, gender, birth_year) values
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-0000000000f1', 'Grandfather', 'male',   1930),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000f1', 'C father',    'male',   1955),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000f1', 'U uncle',     'male',   1958),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000f1', 'B',           'male',   1980),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000f1', 'D cousin',    'female', 1985),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000f1', 'K child',     'female', extract(year from now())::int - 5),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000f1', 'A admin',     'female', 1975),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000f1', 'S sibling',   'female', 1983),
  ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-0000000000f2', 'E outsider',  'male',   1970);
insert into relationships (family_id, person_a, person_b, type, subtype) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000101', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000102', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000103', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000107', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000104', 'parent_of', 'biological'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000105', 'parent_of', 'biological');
insert into members (family_id, user_id, person_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000106', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000103', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000101', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000104', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-000000000107', 'member'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000200', 'admin');
insert into person_contacts (person_id, family_id, phone, email) values
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000f1', '+919800000001', 'b@example.com');

-- ─── Nobody outside sees anything ────────────────────────────────────────────
set role anon;
select pg_temp.expect_fail('logged-out visitors cannot read people', $$select * from persons$$, 'permission denied');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok('a member of another family sees none of this family',
  pg_temp.rows($$select 1 from persons where family_id = '00000000-0000-0000-0000-0000000000f1'$$) = 0);
select pg_temp.logout();

-- ─── Phone numbers (§4.2) ────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok('a cousin can see the family tree', pg_temp.rows($$select 1 from persons$$) = 8);
select pg_temp.ok('a cousin cannot see B''s phone', pg_temp.rows($$select 1 from person_contacts$$) = 0);
select pg_temp.ok('the cousin is told who to ask: B''s father and sibling',
  pg_temp.rows($$select 1 from contact_holders('00000000-0000-0000-0000-000000000103')$$) = 2);
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('a father can see his son''s phone', pg_temp.rows($$select 1 from person_contacts$$) = 1);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000f9');
select pg_temp.ok('a sibling can see the phone', pg_temp.rows($$select 1 from person_contacts$$) = 1);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok('an admin cannot see phone numbers', pg_temp.rows($$select 1 from person_contacts$$) = 0);
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail('B cannot change his own number directly (needs codes on old and new)',
  $$update person_contacts set phone = '+919800000002'$$, 'permission denied');
select pg_temp.ok('B can hide his number', pg_temp.affected($$update person_contacts set phone_hidden = true$$) = 1);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('once hidden, even his father cannot see it', pg_temp.rows($$select 1 from person_contacts$$) = 0);
select pg_temp.logout();

-- ─── Editing people (§5, §4.1) ───────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok('a cousin cannot edit B directly',
  pg_temp.affected($$update persons set city = 'X' where id = '00000000-0000-0000-0000-000000000103'$$) = 0);
select pg_temp.ok('the cousin can propose the edit instead',
  pg_temp.affected($$insert into edit_requests (family_id, target_person_id, proposed_changes, submitted_by)
                     values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000103', '{"city": "Nagercoil"}', '00000000-0000-0000-0000-0000000000d1')$$) = 1);
select pg_temp.ok('the cousin cannot approve their own proposal',
  pg_temp.affected($$update edit_requests set status = 'approved', reviewed_by = '00000000-0000-0000-0000-0000000000d1', reviewed_at = now()$$) = 0);
select pg_temp.ok('the cousin can add a new person',
  pg_temp.affected($$insert into persons (id, family_id, full_name, created_by) values
      ('00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-0000000000f1', 'Made-up parent', '00000000-0000-0000-0000-0000000000d1')$$) = 1);
select pg_temp.ok('and can edit the person they added (birth year unknown)',
  pg_temp.affected($$update persons set native_place = 'Kottar' where id = '00000000-0000-0000-0000-000000000150'$$) = 1);
select pg_temp.expect_fail('but cannot attach that person to B as a parent',
  $$insert into relationships (family_id, person_a, person_b, type, subtype, created_by) values
      ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-000000000103', 'parent_of', 'step', '00000000-0000-0000-0000-0000000000d1')$$,
  'row-level security');
select pg_temp.expect_fail('nobody can add people to another family',
  $$insert into persons (family_id, full_name, created_by) values ('00000000-0000-0000-0000-0000000000f2', 'X', '00000000-0000-0000-0000-0000000000d1')$$,
  'row-level security');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('B approves the proposal about himself',
  pg_temp.affected($$update edit_requests set status = 'approved', reviewed_by = '00000000-0000-0000-0000-0000000000b1', reviewed_at = now()$$) = 1);
select pg_temp.ok('B can edit his own profile',
  pg_temp.affected($$update persons set city = 'Nagercoil' where id = '00000000-0000-0000-0000-000000000103'$$) = 1);
select pg_temp.ok('B can edit his young child',
  pg_temp.affected($$update persons set city = 'Nagercoil' where id = '00000000-0000-0000-0000-000000000105'$$) = 1);
select pg_temp.ok('B can add a newborn',
  pg_temp.affected($$insert into persons (id, family_id, full_name, birth_year, created_by) values
      ('00000000-0000-0000-0000-000000000151', '00000000-0000-0000-0000-0000000000f1', 'Newborn', extract(year from now())::int, '00000000-0000-0000-0000-0000000000b1')$$) = 1);
select pg_temp.ok('and link the newborn as his child',
  pg_temp.affected($$insert into relationships (family_id, person_a, person_b, type, subtype, created_by) values
      ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000151', 'parent_of', 'biological', '00000000-0000-0000-0000-0000000000b1')$$) = 1);
select pg_temp.expect_fail('only an admin can mark someone an adult',
  $$update persons set adult_confirmed = true where id = '00000000-0000-0000-0000-000000000105'$$, 'Only an admin');
select pg_temp.ok('B cannot delete anyone', pg_temp.affected($$delete from persons where id = '00000000-0000-0000-0000-000000000105'$$) = 0);
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('a grandfather cannot edit a minor grandchild (only parents and admins)',
  pg_temp.affected($$update persons set city = 'X' where id = '00000000-0000-0000-0000-000000000105'$$) = 0);
select pg_temp.logout();

-- ─── Admin powers need MFA (§5a) ─────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select pg_temp.ok('an admin without authenticator sign-in has no admin powers',
  pg_temp.affected($$delete from persons where id = '00000000-0000-0000-0000-000000000150'$$) = 0);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok('with authenticator sign-in the admin can remove a record',
  pg_temp.affected($$delete from persons where id = '00000000-0000-0000-0000-000000000150'$$) = 1);
select pg_temp.ok('the admin can read the audit log', pg_temp.rows($$select 1 from audit_log$$) > 0);
select pg_temp.ok('the admin sees every member', pg_temp.rows($$select 1 from members$$) = 5);
select pg_temp.ok('the admin can export the family',
  (select jsonb_array_length(export_family('00000000-0000-0000-0000-0000000000f1') -> 'persons')) = 9);
select pg_temp.expect_fail('the only admin cannot step down',
  $$update members set role = 'member' where user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'at least one admin');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('a member sees only their own membership row', pg_temp.rows($$select 1 from members$$) = 1);
select pg_temp.ok('a member can switch the app to Tamil',
  pg_temp.affected($$update members set ui_language = 'ta' where user_id = '00000000-0000-0000-0000-0000000000b1'$$) = 1);
select pg_temp.expect_fail('a member cannot make themselves admin',
  $$update members set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000b1'$$, 'Only an admin');
select pg_temp.ok('a member cannot read the audit log', pg_temp.rows($$select 1 from audit_log$$) = 0);
select pg_temp.expect_fail('a member cannot export the family',
  $$select export_family('00000000-0000-0000-0000-0000000000f1')$$, 'Only an admin');
select pg_temp.expect_fail('a member cannot create invites',
  $$insert into invites (family_id, token_hash, created_by, expires_at) values ('00000000-0000-0000-0000-0000000000f1', sha256('x'), '00000000-0000-0000-0000-0000000000b1', now() + interval '7 days')$$,
  'row-level security');
select pg_temp.logout();

-- ─── Password reset (§5a) ────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect_fail('a cousin cannot start a reset for B',
  $$select request_recovery('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1')$$, 'immediate-family');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('B''s father can start a reset',
  (select request_recovery('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1')) is not null);
select pg_temp.expect_fail('only one open reset at a time',
  $$select request_recovery('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1')$$, 'recovery_one_open_uq');
select pg_temp.expect_fail('the relative cannot also approve it',
  $$select approve_recovery((select id from recovery_requests limit 1))$$, 'Another admin');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select approve_recovery((select id from recovery_requests limit 1));
select pg_temp.ok('an admin approves the reset',
  (select status = 'approved' and approved_by = '00000000-0000-0000-0000-0000000000a1' from recovery_requests));
select pg_temp.logout();

-- Email-exempt member: a second relative must confirm before an admin can approve.
update members set email_exempt = true, email_exempt_by = '00000000-0000-0000-0000-0000000000a1',
                   email_exempt_reason = 'No email', email_exempt_at = now()
 where user_id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select request_recovery('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.expect_fail('no admin approval for an exempt member until a second relative confirms',
  $$select approve_recovery((select id from recovery_requests where target_user_id = '00000000-0000-0000-0000-0000000000c1'))$$,
  'second relative');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail('the first relative cannot confirm twice',
  $$select confirm_recovery((select id from recovery_requests where target_user_id = '00000000-0000-0000-0000-0000000000c1'))$$,
  'second, different');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000f9');
select confirm_recovery((select id from recovery_requests where target_user_id = '00000000-0000-0000-0000-0000000000c1'));
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select approve_recovery((select id from recovery_requests where target_user_id = '00000000-0000-0000-0000-0000000000c1'));
select pg_temp.ok('after a second relative confirms, the admin can approve',
  (select status = 'approved' from recovery_requests where target_user_id = '00000000-0000-0000-0000-0000000000c1'));
select pg_temp.logout();

-- ─── Announcements (§5b) ─────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok('a member can draft an announcement',
  pg_temp.affected($$insert into announcements (family_id, type, title, audience, created_by)
                     values ('00000000-0000-0000-0000-0000000000f1', 'birth', 'New baby', 'all', '00000000-0000-0000-0000-0000000000d1')$$) = 1);
select pg_temp.expect_fail('a member cannot mark it sent (only the server sends)',
  $$update announcements set status = 'sent', sent_at = now()$$, 'row-level security');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('other members do not see drafts', pg_temp.rows($$select 1 from announcements$$) = 0);
select pg_temp.expect_fail('demise notices cannot be muted',
  $$insert into notification_prefs (family_id, user_id, type, email_enabled) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'demise', false)$$,
  'demise_always_emailed');
select pg_temp.logout();
update announcements set status = 'sent', sent_at = now();
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('once sent to all, every member sees it', pg_temp.rows($$select 1 from announcements$$) = 1);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok('the other family does not', pg_temp.rows($$select 1 from announcements$$) = 0);
select pg_temp.logout();

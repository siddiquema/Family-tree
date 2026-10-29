-- Keepalive ping (§ ops) — see supabase/migrations/20261029000001_health_check.sql.
-- Confirms anon can call it, and still can't read anything else.
set client_min_messages = warning;

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok   %', label;
end $$;
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
set client_min_messages = notice;

insert into families (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Family one');

set role anon;
select pg_temp.ok('anon can call health_check and gets a timestamp back',
  (select health_check() is not null));
select pg_temp.expect_fail('anon still cannot read any family data',
  $$select * from families$$,
  'permission denied');
reset role;

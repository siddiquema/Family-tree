-- Lets an unauthenticated keepalive ping (the GitHub Action that stops the free-tier project
-- from auto-pausing after 7 days idle) register real activity without reading any family data.
-- No table or view is granted to anon anywhere in this schema (access_rules.sql revokes it
-- explicitly) — this is a single function that returns nothing but the current time.
create or replace function public.health_check() returns timestamptz
language sql stable as $$ select now() $$;

revoke all on function public.health_check from public;
grant execute on function public.health_check to anon;

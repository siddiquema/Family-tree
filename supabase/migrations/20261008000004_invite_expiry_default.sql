-- createInvite() computed expires_at on the client (Date.now() + 7 days) and compared it
-- against created_at (set by the database's own clock) via a zero-tolerance check
-- constraint (expires_at <= created_at + interval '7 days'). Any client clock even
-- slightly ahead of the database server's clock makes that insert fail outright. Moving
-- the +7 days to a DB-side default means both columns come from the same now() call
-- within the same transaction, so there's no clock to skew.
alter table public.invites alter column expires_at set default (now() + interval '7 days');

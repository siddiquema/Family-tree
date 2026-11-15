# Incident: stuck on "Loading your family…" after login

**Date:** 15 Nov 26 · **Reported by:** Siddique · **Status:** Resolved

## Symptom

Logging in (including on `#/admin`) got stuck indefinitely on the "Loading your family…"
screen. A stray literal `null` also briefly appeared on the page during the same incident.

## Timeline

1. First report: stuck loading, with a literal `null` printed on the page.
2. Fix 1 shipped (commit `0c790bd`): handled a *stale session* case — a cached login session
   that the server no longer recognised (expired token, or every session for that login
   revoked, e.g. by the admin password-reset tool) threw an uncaught error deep in the loading
   logic, leaving the screen stuck forever with nothing shown. Also fixed the stray `null`
   (see below).
3. Reported again after a fresh login: still stuck, `null` gone.
4. Fix 2 shipped (commit `9bd8254`): added a 20s timeout around the whole load, in case a
   request was hanging rather than erroring (e.g. a stalled connection). Asked for the
   browser console output to confirm.
5. Console showed the real cause: `RangeError: Invalid time value` in a promise, not a timeout
   or a network error.
6. Fix 3 shipped (commit `82a8ca2`): the actual root cause — see below.

## Root causes (three separate bugs, found in this order)

### 1. No fallback for a dead local session
`afterPasswordVerified()` assumed a cached browser session was still valid server-side. When
it wasn't, `supabase.auth.getUser()` returned a null user, and the next line (`user.id`) threw
with nothing to catch it — an unhandled rejection, so `state.ready` never became `true` and no
error was ever shown.

**Fix:** wrapped the whole function in try/catch; on failure it now signs out and shows "Your
session expired. Please sign in again." instead of hanging.

### 2. `replaceChildren(null)` renders the string `"null"`
`main.js` built the page from an array that included a bare JS `null` for "no tab bar yet" (while
loading). `Node.replaceChildren()` stringifies any non-Node argument it's given — so that `null`
became a literal `null` text node on the page, not nothing. This was normally invisible (gone in
under a second once loading finished), so bug 1 making the load hang forever is what made it
stick around long enough to notice.

**Fix:** filter falsy children out before calling `replaceChildren()`.

### 3. The actual crash: an invalid date, thrown during render (the real root cause)
`Intl.DateTimeFormat.prototype.format()` throws `RangeError: Invalid time value` if given an
invalid `Date` — it doesn't print a placeholder. `admin.js`'s `formatWhen()` (used for invite
expiry/used timestamps) did `new Intl.DateTimeFormat(…).format(new Date(iso))` with no check
that `iso` actually parsed to a valid date. One invite record in the database apparently has a
timestamp value that doesn't parse cleanly.

Because this happened *during* the render that was meant to replace "Loading your family…"
with the real page, that render never completed — the old loading text just stayed on screen,
with no visible error. The app had actually finished loading the data successfully; the crash
was purely in *displaying* it afterwards. This is why bug 1's timeout/catch logic (which only
guards the data-loading step) never caught it, and why it looked identical to a hang.

**Fix:**
- `formatWhen()` (admin.js) and the shared `formatDate()` (i18n/index.js) now check
  `Number.isNaN(d.getTime())` and fall back to a placeholder instead of throwing.
- `main.js`'s `render()` is now wrapped in its own try/catch — any future bug in a single
  view's rendering shows a recoverable "Something went wrong — Reload" message instead of
  silently freezing the app on its last successful screen.

## Why it looked like a hang

All three bugs shared the same visible symptom (a frozen "Loading your family…" screen) for
different reasons — the first was a genuine stuck state with no error path, the third was a
render crash that never got the chance to update the DOM. Nothing printed to the page in either
case, which is why the browser console (rather than anything the app itself could show at the
time) was what actually identified bug 3.

## Follow-up (not yet done)

The stack trace pointed at the admin screen's invites list, which only ever calls `formatWhen()`
on `invites.expires_at` / `invites.used_at` — both are `timestamptz` columns in Postgres, which
can't normally hold a value JavaScript's `Date` parser rejects, so it's not fully confirmed which
row or which column actually triggered this. It's now harmless either way (shows `—` instead of
crashing), so there's no urgency, but if it's worth tracking down: pull every invite row and
eyeball the two timestamp columns —

```sql
select id, person_id, created_at, expires_at, used_at, used_by from invites order by created_at;
```

(read-only, safe to run any time via `scripts/apply-one.mjs` or `psql`) — anything that doesn't
look like a normal timestamp, or is unexpectedly blank, is the suspect.

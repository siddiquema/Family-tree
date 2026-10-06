# Database

Postgres on Supabase. Schema lives in `supabase/migrations/` and is applied in file order.

| File | Contents |
|---|---|
| `…01_core_tables.sql` | Tables, CHECK constraints, unique keys, indexes |
| `…02_integrity_triggers.sql` | Rules that span rows (ancestry loops, parent count, ages), append-only audit |
| `…03_access_rules.sql` | Helper functions, row-level security on every table, column grants, recovery RPCs |
| `…04_interop.sql` | Sources, external IDs, full export, GEDCOM family units |
| `…05_kinship_seed.sql` | 40 draft kinship terms copied into every new family |

## Tables

```
families ─┬─ members ──────────── (user ↔ claimed person, role, email exemption, language)
          │    ├─ invites
          │    └─ recovery_requests
          ├─ persons ─┬─ relationships (parent_of | spouse_of only)
          │           ├─ person_contacts (phone, email — own access rules)
          │           ├─ education · work · photos
          │           ├─ person_sources ── sources
          │           └─ external_ids
          ├─ edit_requests
          ├─ announcements ─┬─ announcement_subjects
          │                 └─ announcement_recipients
          ├─ notification_prefs
          ├─ kinship_terms · kinship_missing
          └─ audit_log (append-only)
```

Every table carries `family_id`. Child tables reference `(person_id, family_id)` as a pair, so a row can never point at a person in another family. The database rejects it, whatever the app does.

Changes from the starting model in `CLAUDE.md` §3:

| Was | Now | Why |
|---|---|---|
| `persons.claimed_by` | `members.person_id` | The same fact was stored twice, so the two copies could disagree |
| `persons.profile_photo_url` | `photos.is_profile` (one per person) | The photo row already exists, and a URL can go stale |
| `announcements.related_person_ids[]` | `announcement_subjects` table | Array items can't have foreign keys |
| `persons.phone`, `phone_visibility` | `person_contacts` | Row-level security can't hide one column |
| — | `sources`, `person_sources`, `external_ids` | Provenance and connectors (below) |
| — | `kinship_missing` | The admin "missing terms" list |

## Integrity rules

**Blocked (impossible data)**
- A known name can't be blank. A placeholder (`name_known = false`) can't have a name.
- Birth and death years can't be in the future. Death can't come before birth. Someone with a death recorded can't be marked living. A date must match its year.
- Nobody can be their own parent or ancestor, checked through the whole tree.
- A person has at most two biological parents, and not both of the same known gender.
- A parent must be born before their child. This is re-checked when either birth year changes.
- Spouses can't also be parent and child. A couple is stored once, lower ID first.
- Phone numbers must be in `+91…` form. A contact can't be marked verified without a value. There are no duplicate phones or emails within a family.
- Edit requests can't be approved by the person who submitted them. Demise notices can't be muted. A family always keeps at least one admin.
- `audit_log` can't be updated or deleted.

**Allowed but reported** (`scripts/integrity-report.sql`)
- Very young or very old parents, and births after a parent's death.
- People born more than 90 years ago with no death recorded, and anyone marked living past 110.
- Same name with similar birth years (duplicate or namesake?).
- More than one current spouse. This is valid, so it's reported, never blocked.
- Gaps that limit features: unknown gender, unknown birth year, one parent only, placeholders.

## Access rules (summary)

- Logged-out visitors can read nothing. A member of another family can read nothing from this family.
- Every member of the family can read the tree.
- **Direct edits:**
  - An admin can edit anyone.
  - A parent can edit their child.
  - Unless the person is a *known* minor, they can also be edited by themselves, their spouse, or whoever added them.
  - Everyone else uses `edit_requests`.
- Phone and email are visible to the person and their immediate family only, and not to admins. A person can hide theirs. Phone and email can't be changed directly. That goes through the verified-change flow in an Edge Function.
- Admin powers need an authenticator-app sign-in (`aal2`). An admin signed in with a password only has member rights.
- Password reset goes through `request_recovery` → `confirm_recovery` (email-exempt members only) → `approve_recovery`. The codes and the new password are then handled by an Edge Function.

Two decisions this implements that the spec left open:
- **Spouse in "immediate family" means a current marriage.** A divorced spouse no longer sees the number.
- **An unknown birth year counts as a minor for privacy, but not for edit rights.** Otherwise relatives couldn't edit ancestors they've added.

## Moving to another app, and connecting other trees

The data is kept app-neutral:
- **Plain SQL.** Supabase-specific calls are limited to `auth.uid()` and `auth.jwt()`, inside `app.current_user_id()` and `app.is_admin()`. Value lists are `text` + `CHECK`, not Postgres enums.
- **Stable IDs.** Every record has a UUID that never changes, so exports, links and connectors keep working across moves.
- **Provenance.** `sources` / `person_sources` record where each person came from (the 2011 spreadsheet, a GEDCOM file, a member's entry). An import can be traced or rolled back.
- **External IDs.** `external_ids` maps a person to their record in another system. Uniqueness rules: one remote record per local person, per system. Re-imports and sync match on these, never on names. The seed import already uses this (`seed_xlsx_2011`), which is why re-running it updates the same people instead of creating duplicates.
- **Full export.** `export_family(family_id)` is admin-only. It returns one JSON document with every person, link, record and kinship term. Phone numbers and emails are left out on purpose. They move only with each person's consent.
- **GEDCOM-ready.** The `family_units` view derives GEDCOM's family records (a couple plus their children, or a single parent plus children) from the stored links. A GEDCOM 5.5.1 / 7.0 exporter only has to format this.

GEDCOM mapping, for the Phase 2 import/export:

| GEDCOM | Here |
|---|---|
| `INDI` | `persons` (`@I…@` xref kept in `external_ids`, system `gedcom`) |
| `NAME`, `NICK` | `full_name`, `known_as`; `house_name` goes in `_HOUSE` (custom tag) |
| `SEX M/F/U` | `gender` |
| `BIRT`/`DEAT` `DATE` (`ABT` if approximate) | `birth_year`/`birth_date`, `birth_year_approx`, `death_year`/`death_date` |
| `FAM` `HUSB`/`WIFE`/`CHIL` | `family_units` view |
| `PEDI birth/adopted/step` | `relationships.subtype` |
| `MARR`/`DIV` | `spouse_of` `status`, `start_year`, `end_year` |
| `EDUC`, `OCCU` | `education`, `work` |
| `SOUR` | `sources`, `person_sources` |

**Connectors to other family trees** (FamilySearch, Geni, WikiTree, MyHeritage, or another family's copy of this app) follow one pattern:
1. Pull the remote records.
2. Match each one through `external_ids`, falling back to name and birth year, which an admin confirms.
3. Write proposed changes as `edit_requests`, never directly.
4. Record the run in `sources` with kind `connector`.

That keeps the approval step and the audit trail for every outside change. Most of these services need a developer agreement and OAuth, and some charge, so each one gets flagged before it's built. Linking two families that both use this app works the same way, using the shared person's `external_ids` in each family. No data is shared between families without both admins agreeing.

## Running

Copy `.env.example` to `.env` (gitignored) and fill in `DATABASE_URL` (Supabase → Project Settings →
Database → Connect → **Session pooler**) and `FAMILY_NAME`. `npm run seed:import` and `npm run seed:sql`
pick it up automatically (`node --env-file-if-exists=.env`); without a `.env`, pass the same variables
inline instead.

```
tests/run.sh                                # needs local PostgreSQL 15+; builds a fresh DB per test file
npm run seed:import                         # loads seed/persons.csv + relationships.csv into Supabase
psql "$DATABASE_URL" -X -f scripts/integrity-report.sql
```
`tests/supabase_shim.sql` stands in for Supabase's `auth` schema and roles in local tests only. Never apply it to a real project.

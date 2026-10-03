# Family Tree Webapp — Project Handover

**Owner:** Siddique Ahamed · **Handover date:** 03 Oct 26 · **Status:** Pre-build (Phase 0)

> Place this file at the repo root as `CLAUDE.md`. Read it fully before writing code.
> Ask before deviating from any decision marked **[DECIDED]**. Items marked **[OPEN]** need Siddique's input.

---

## 1. Purpose

A private, mobile-first family tree for Siddique's extended family (est. 100–500 people). Relatives add and maintain their own branches.
Built for one family first. Turning it into a product for other families depends on measured adoption (see §8).

### Why this exists (design driver)
Earlier attempts on GenoPro, Family Echo (2011), Ancestry and imlee (2012–13) all stalled. One person was entering and maintaining everything; the Family Echo tree was never updated after 2011.
**The core feature is distributed contribution, not the tree view.** Every design choice should reduce the effort for a relative to add or fix their own data.

---

## 2. Stack [DECIDED unless noted]

| Layer | Choice | Note |
|---|---|---|
| Frontend | PWA, mobile-first | React + Vite + TypeScript recommended **[OPEN — confirm vs vanilla]** |
| Backend | Supabase (Postgres, Auth, Storage, RLS) | Free tier for v1 |
| Auth | Invite-only, password login; phone + email both verified by OTP | **[DECIDED]** See §5a. SMS = paid (Twilio etc. + India DLT) — flagged |
| Email delivery | Free-tier SMTP (Brevo / Resend) | Supabase built-in SMTP is rate-limited; not for production |
| Server logic | Supabase Edge Functions | Invite redemption and recovery need the service role; never ship it to the client |
| Hosting | GitHub Pages (static PWA) | GitHub user: `siddiquema`. Repo is public on the free plan — code only, never data (§9) |
| Tree rendering | Evaluate existing libs (e.g. `family-chart`, d3-based) before building custom | |

**Multi-tenant-ready from day one [DECIDED]:** every table carries `family_id`, and every RLS policy scopes by it. Do NOT build billing, family onboarding or super-admin UI yet.

---

## 3. Data model (starting point — refine in Phase 0)

```
families        id, name, created_at
members         user_id (auth), family_id, person_id (claimed profile), role: admin | branch_owner | member,
                email_exempt (bool), email_exempt_by, email_exempt_reason, email_exempt_at
persons         id, family_id, full_name, known_as, gender,
                birth_year (nullable), birth_year_approx (bool), birth_date (optional),
                is_living, death_year,
                native_place, city, state, country,
                profile_photo_url, claimed_by (user_id, nullable),
                created_by, updated_at
person_contacts person_id, family_id, phone, email, phone_hidden (bool)
                -- separate table: RLS is row-level, so contact fields cannot live on persons
relationships   id, family_id, person_a, person_b,
                type: parent_of | spouse_of,
                subtype: biological | adoptive | step,
                status (spouse only): married | divorced | widowed
education       id, family_id, person_id, degree, institution, year
work            id, family_id, person_id, type: job | business | self_employed | homemaker | retired | student,
                org_name, role, is_current
photos          id, family_id, person_id, url, uploaded_by, created_at
edit_requests   id, family_id, target_person_id, proposed_changes (jsonb),
                submitted_by, status: pending | approved | rejected, reviewed_by
invites         token_hash, family_id, person_id (nullable), created_by, expires_at, used_at
recovery_requests id, family_id, target_user_id, authorised_by, approved_by (admin),
                status: authorised | approved | completed | expired | cancelled,
                expires_at, completed_at
announcements   id, family_id, type: marriage | birth | event | demise | general,
                title, body, event_date (nullable), location (nullable), related_person_ids[],
                audience: all | selected, created_by, approved_by (nullable),
                status: draft | pending_approval | sent | cancelled, sent_at
announcement_recipients announcement_id, family_id, user_id, emailed_at, read_at
notification_prefs user_id, family_id, type, email_enabled (bool)
audit_log       id, family_id, actor_user_id, action, target, created_at
                -- invites, recoveries, role changes, contact reads are logged
```

Rules:
- **Store birth year/date, never age.** Compute age and minor status at read time.
- Store only `parent_of` and `spouse_of` links. Derive siblings, cousins, uncles etc. by graph traversal.
- Support remarriage, adoption and half-siblings in the schema from the start.
- `birth_year` is nullable because many ancestors have no known year. Minor check: unknown year counts as a minor unless the person is deceased or an admin confirms they are an adult.
- Store tokens (invite, recovery) only as hashes.

### Immediate family [DECIDED]
Used for both phone visibility (§4) and recovery authorisation (§5a):
the person's **parents, children, siblings (share ≥1 parent, so half-siblings count) and spouse**.
Biological, adoptive and step parents all count as parents. Step-siblings (no shared parent) do **not** count.
Implement once as a SQL function `is_immediate_family(viewer_person, target_person)` and reuse it.

---

## 4. Privacy rules [DECIDED] — enforce in RLS, not just UI

1. **Minors (computed under 18):** photos and details are visible only to logged-in family members. Only parents (and admin) can edit them. Never exposed publicly.
2. **Phone numbers:** visible only to the person and their immediate family (§3). Admins do **not** see them. A person can set `phone_hidden` to hide it from everyone. Everyone else sees "Ask <nearest immediate-family member> for this number", computed by graph traversal.
3. **Living people:** private to members by default.
4. **Deceased people:** can be shown more widely within the family.
5. No public or unauthenticated read of any person data in v1.

---

## 5. Contribution flow (core of v1)

- **Invite via WhatsApp link** → the relative opens it on their phone → verifies phone + email by OTP → sets password → claims their profile (or creates one) → adds their branch. No app install. Public sign-up is disabled; an invite is the only way in.
- **Add upward/downward:** "Add my parents", "Add my children", "Add my spouse".
- **Edit permissions:** users can directly edit their own profile and their own branch (spouse, children). Edits to anyone else go into `edit_requests` for approval by that branch owner or an admin.
- **Missing-info nudges:** show prompts like "Your uncle has no photo" to drive completion.

---

## 5a. Account security [DECIDED — strictest model]

### Onboarding
1. Invite token: single use, 7-day expiry, stored hashed.
2. Edge Function validates the token, then requires **both phone (SMS OTP) and email (email OTP)** to be verified. Exception: members an admin has marked email-exempt (below) verify phone only.
3. User sets a password (min 12 chars). Account is created server-side and linked to `members` / `persons`.

### Login
- Phone or email + password.
- Optional authenticator-app MFA (Supabase TOTP, free). Required for admins.

### Password recovery — no self-service reset
All four steps are mandatory; failing any one cancels the request.
1. **Relative authorises:** a logged-in immediate-family member (§3) taps "Help reset login". Cannot be the target themselves.
2. **Admin approves:** a second, independent check. Admins recovering their own account need another admin.
3. **Both channels verified:** OTP to the phone **and** OTP to the email already on file. Contacts cannot be changed during recovery.
4. **New password set:** all existing sessions revoked; user notified on both channels.

Guards:
- Recovery request expires in 24 h; OTPs in 10 min; max 5 OTP attempts, then the request is cancelled.
- Max 1 open recovery per user; max 3 per user per 30 days.
- Changing a verified phone or email needs OTP on the old **and** new contact.
- Every step is written to `audit_log`; admins see a recovery history.

### Email exemption (admin override) [DECIDED]
For relatives without email (often elders). One email channel is lost, so an extra human check replaces it.
- Only an admin can set it, per member, with a mandatory reason. It can be set on the invite (before onboarding) or later.
- Onboarding: phone OTP only.
- Recovery: relative authorises → **a second, different immediate-family relative confirms** → admin approves → SMS OTP → new password.
- Login MFA is unchanged. Admins cannot be email-exempt.
- Revocable at any time. Cleared automatically once the member adds and verifies an email.
- Set, revoke and use are all written to `audit_log`. Admins see a list of all exempt members.

Cost note: SMS is paid (onboarding + recovery only, so volume is low). Get Siddique's OK on the provider before enabling it.

---

## 5b. Family announcements [DECIDED]

Announce marriages, births, events and demises to selected members or to everyone.

**Audience**
- **All members** of the family, or
- **Selected members**, picked individually or in bulk by branch ("all descendants of X") or by immediate family of a person. A preview shows the recipient count before sending.

**Who can send**
- Admins and branch owners: send directly.
- Members: can draft; the draft goes to an admin for approval (`pending_approval`) before it is sent.

**Delivery**
- In-app feed, always, for every recipient. This is the record.
- Email via the free-tier SMTP (§2), sent by an Edge Function. The sender never sees recipients' emails or phones; the §4 contact rules still apply.
- Email-exempt members: in-app only, plus a **"Share to WhatsApp"** button for the sender (opens WhatsApp with the text pre-filled; free, no API).
- **No paid SMS or WhatsApp Business API** for announcements. Flag before adding one.

**Rules**
- Recipients can turn off email per type in `notification_prefs`. **Demise notices always email** (cannot be muted).
- A demise announcement prompts the sender to mark the person deceased (`is_living = false`, `death_year`). It goes through `edit_requests` if they are not the branch owner.
- Announcements mentioning a minor follow §4: only logged-in members see them, never public.
- Rate limit: max 10 announcements per sender per day.

---

## 6. Scope

### v1 (build this)
- Phone auth + invite links + profile claiming
- Person profile: name, known-as, photos, birth year/DOB, living status, native place, city/state/country, optional phone with visibility, education (multiple), work (typed)
- Relationship linking (parents, children, spouse)
- Interactive tree view (pan/zoom, mobile-friendly)
- **Relationship calculator:** show how any two people are related, with paternal/maternal and elder/younger distinct. English labels first, plus the family's language **[OPEN — which language(s)]**
- Edit-approval queue
- Family announcements to selected members or all (§5b)
- Privacy rules (§4)
- Basic usage logging needed for the §8 metrics

### Phase 2 (do NOT build yet)
Birthday/anniversary reminders · directory search (by city, profession etc.) · memorial pages · GEDCOM import/export · printable tree poster · event RSVPs and calendar invites (announcements themselves moved to v1, §5b).

---

## 7. Build phases

| Phase | Deliverable | Exit check |
|---|---|---|
| 0 — Scaffold | Repo, Supabase project, schema + RLS, seed import script | RLS tests pass; seed data loads |
| 1 — Core | Auth, profiles, relationship linking, tree view | Siddique can build his own branch end-to-end |
| 2 — Contribution | Invites, claiming, edit approval, nudges, announcements | 3–5 pilot relatives add data unaided |
| 3 — Launch | Kinship calculator, privacy hardening, metrics logging | Shared with the wider family |

Tag a git release at each phase exit.

---

## 8. Adoption signals (decide product direction at 90 days)

Thresholds are initial assumptions; tune them to the actual family size.

| Signal | Threshold |
|---|---|
| Claim rate | ≥40% of reachable adult relatives claim a profile within 90 days |
| Contributors | ≥10 people other than Siddique add or edit data |
| Return use | Relatives return monthly without being prompted |
| Feature pull | Which features get used, to decide what a product version leads with |

If contributor numbers stay low, that answers the product question too.

---

## 9. Seed data [OPEN]

- `family tree.xlsx` (26 Jun 11): in Siddique's Gmail sent folder. Write an import script once its structure is known.
- **[DECIDED]** Seed files hold real personal data, including minors. `/seed` is gitignored; never commit data. Run imports locally only.
- Family Echo account: attempt a GEDCOM export if the login still works.

---

## 10. Working conventions

- Brevity and structure. Lead with the result, then state assumptions explicitly.
- Dates: DD MMM YY.
- No placeholder sections or filler code. Every file committed should be functional.
- Before adding any paid tool or service, flag it. Siddique prefers tools he already owns or free tiers.
- Commit small. Explain the reasoning in commit messages.

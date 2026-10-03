-- Core tables. Plain PostgreSQL apart from references to auth.users (Supabase Auth).
-- Value lists use text + CHECK rather than enum types: easier to extend in place and
-- portable to other databases if the app ever moves off Supabase.

create schema if not exists app;  -- private helpers; not exposed through the Supabase API

-- ─── Families (tenants) ──────────────────────────────────────────────────────
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  created_at  timestamptz not null default now()
);

-- ─── People ──────────────────────────────────────────────────────────────────
create table public.persons (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references public.families(id) on delete cascade,

  full_name         text,
  name_known        boolean not null default true,
  full_name_ta      text,
  known_as          text,             -- personal nickname
  house_name        text,             -- house/family nickname used by older generations
  house_name_ta     text,
  gender            text not null default 'unknown' check (gender in ('male', 'female', 'unknown')),

  birth_year        smallint check (birth_year between 1500 and 2200),
  birth_year_approx boolean not null default false,
  birth_date        date,
  is_living         boolean,          -- null = not known; treated as living for privacy
  death_year        smallint check (death_year between 1500 and 2200),
  death_date        date,
  adult_confirmed   boolean not null default false,  -- admin override when birth year is unknown

  native_place      text,
  city              text,
  state             text,
  country           text,
  notes             text,

  merged_into       uuid,             -- set when a duplicate is merged; row kept for history
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Target for composite foreign keys, so a row can only link to people in its own family.
  unique (id, family_id),
  foreign key (merged_into, family_id) references public.persons(id, family_id),

  constraint name_known_matches_name
    check (name_known = (full_name is not null and btrim(full_name) <> '')),
  constraint birth_date_matches_year
    check (birth_date is null or birth_year = extract(year from birth_date)::int),
  constraint death_date_matches_year
    check (death_date is null or death_year = extract(year from death_date)::int),
  constraint death_implies_not_living
    check ((death_year is null and death_date is null) or is_living = false),
  constraint death_after_birth
    check (death_year is null or birth_year is null or death_year >= birth_year),
  constraint death_date_after_birth_date
    check (death_date is null or birth_date is null or death_date >= birth_date),
  constraint not_merged_into_self check (merged_into is null or merged_into <> id)
);
create index persons_family_idx on public.persons (family_id);
create index persons_name_idx on public.persons (family_id, lower(full_name));
create index persons_house_idx on public.persons (family_id, lower(house_name)) where house_name is not null;

-- Phone and email live apart from persons: row-level security works per row,
-- so a column on persons could not be hidden from members who may see the profile.
create table public.person_contacts (
  person_id          uuid primary key,
  family_id          uuid not null,
  phone              text check (phone ~ '^\+[1-9][0-9]{6,14}$'),               -- E.164
  email              text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_verified_at  timestamptz,
  email_verified_at  timestamptz,
  phone_hidden       boolean not null default false,
  has_whatsapp       boolean not null default true,
  updated_at         timestamptz not null default now(),
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade,
  check (phone_verified_at is null or phone is not null),
  check (email_verified_at is null or email is not null)
);
create unique index person_contacts_email_uq on public.person_contacts (family_id, lower(email)) where email is not null;
create unique index person_contacts_phone_uq on public.person_contacts (family_id, phone) where phone is not null;

-- Only two kinds of link are stored. Siblings, cousins, uncles etc. are derived.
create table public.relationships (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null,
  person_a        uuid not null,   -- parent_of: the parent. spouse_of: lower uuid of the pair
  person_b        uuid not null,   -- parent_of: the child.  spouse_of: higher uuid of the pair
  type            text not null check (type in ('parent_of', 'spouse_of')),
  subtype         text check (subtype in ('biological', 'adoptive', 'step')),
  status          text check (status in ('married', 'divorced', 'widowed')),
  marriage_order  smallint check (marriage_order between 1 and 9),
  start_year      smallint check (start_year between 1500 and 2200),
  end_year        smallint check (end_year between 1500 and 2200),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (person_a, family_id) references public.persons(id, family_id) on delete cascade,
  foreign key (person_b, family_id) references public.persons(id, family_id) on delete cascade,
  constraint no_self_link check (person_a <> person_b),
  constraint subtype_only_for_parents
    check ((type = 'parent_of') = (subtype is not null)),
  constraint status_only_for_spouses
    check ((type = 'spouse_of') = (status is not null)),
  constraint spouse_pair_canonical    -- stops (A,B) and (B,A) both being stored
    check (type <> 'spouse_of' or person_a < person_b),
  constraint end_after_start
    check (end_year is null or start_year is null or end_year >= start_year),
  unique (type, person_a, person_b)
);
create index relationships_a_idx on public.relationships (person_a, type);
create index relationships_b_idx on public.relationships (person_b, type);
create index relationships_family_idx on public.relationships (family_id);

create table public.education (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null,
  person_id    uuid not null,
  degree       text not null check (length(btrim(degree)) > 0),
  institution  text,
  year         smallint check (year between 1800 and 2200),
  created_at   timestamptz not null default now(),
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade
);
create index education_person_idx on public.education (person_id);

create table public.work (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null,
  person_id   uuid not null,
  type        text not null check (type in ('job', 'business', 'self_employed', 'homemaker', 'retired', 'student')),
  org_name    text,
  role        text,
  is_current  boolean not null default false,
  start_year  smallint check (start_year between 1800 and 2200),
  end_year    smallint check (end_year between 1800 and 2200),
  created_at  timestamptz not null default now(),
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade,
  check (end_year is null or start_year is null or end_year >= start_year),
  check (not (is_current and end_year is not null))
);
create index work_person_idx on public.work (person_id);

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null,
  person_id     uuid not null,
  storage_path  text not null unique,   -- object key in Supabase Storage
  is_profile    boolean not null default false,
  caption       text,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade
);
create unique index photos_one_profile_uq on public.photos (person_id) where is_profile;

-- ─── Membership and access ───────────────────────────────────────────────────
create table public.members (
  family_id            uuid not null references public.families(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  person_id            uuid,           -- the profile this login has claimed
  role                 text not null default 'member' check (role in ('admin', 'branch_owner', 'member')),
  email_exempt         boolean not null default false,
  email_exempt_by      uuid references auth.users(id),
  email_exempt_reason  text,
  email_exempt_at      timestamptz,
  ui_language          text not null default 'en' check (ui_language in ('en', 'ta')),
  created_at           timestamptz not null default now(),
  primary key (family_id, user_id),
  unique (family_id, person_id),       -- one login per profile
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete set null (person_id),
  constraint exemption_needs_reason
    check (not email_exempt or (email_exempt_by is not null and email_exempt_at is not null
                                and length(btrim(coalesce(email_exempt_reason, ''))) > 0)),
  constraint admins_not_exempt check (not (email_exempt and role = 'admin'))
);
create index members_user_idx on public.members (user_id);

create table public.invites (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade,
  token_hash       bytea not null unique check (length(token_hash) = 32),  -- sha-256; raw token never stored
  person_id        uuid,
  email_exempt     boolean not null default false,
  email_exempt_reason text,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  used_by          uuid references auth.users(id),
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check ((used_at is null) = (used_by is null)),
  check (not email_exempt or length(btrim(coalesce(email_exempt_reason, ''))) > 0)
);

create table public.recovery_requests (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null,
  target_user_id     uuid not null,
  authorised_by      uuid not null,
  second_authoriser  uuid,             -- required when the target is email-exempt
  approved_by        uuid,
  status             text not null default 'authorised'
                       check (status in ('authorised', 'approved', 'completed', 'expired', 'cancelled')),
  otp_attempts       smallint not null default 0 check (otp_attempts between 0 and 5),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '24 hours',
  completed_at       timestamptz,
  foreign key (family_id, target_user_id) references public.members(family_id, user_id) on delete cascade,
  foreign key (family_id, authorised_by)  references public.members(family_id, user_id),
  foreign key (family_id, second_authoriser) references public.members(family_id, user_id),
  foreign key (family_id, approved_by)    references public.members(family_id, user_id),
  check (authorised_by <> target_user_id),
  check (second_authoriser is null or second_authoriser not in (target_user_id, authorised_by)),
  check (approved_by is null or approved_by <> target_user_id),
  check (status not in ('approved', 'completed') or approved_by is not null),
  check ((status = 'completed') = (completed_at is not null)),
  check (expires_at <= created_at + interval '24 hours')
);
create unique index recovery_one_open_uq on public.recovery_requests (target_user_id)
  where status in ('authorised', 'approved');

-- ─── Edits and announcements ─────────────────────────────────────────────────
create table public.edit_requests (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null,
  target_person_id  uuid not null,
  proposed_changes  jsonb not null check (jsonb_typeof(proposed_changes) = 'object' and proposed_changes <> '{}'),
  submitted_by      uuid not null references auth.users(id),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by       uuid references auth.users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (target_person_id, family_id) references public.persons(id, family_id) on delete cascade,
  check ((status = 'pending') = (reviewed_by is null)),
  check ((reviewed_by is null) = (reviewed_at is null)),
  check (reviewed_by is null or reviewed_by <> submitted_by)
);
create index edit_requests_open_idx on public.edit_requests (family_id) where status = 'pending';

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  type         text not null check (type in ('marriage', 'birth', 'event', 'demise', 'general')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text,
  event_date   date,
  location     text,
  audience     text not null check (audience in ('all', 'selected')),
  created_by   uuid not null references auth.users(id),
  approved_by  uuid references auth.users(id),
  status       text not null default 'draft'
                 check (status in ('draft', 'pending_approval', 'sent', 'cancelled')),
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (id, family_id),
  check ((status = 'sent') = (sent_at is not null))
);

-- People an announcement is about (replaces an array column, which cannot carry foreign keys).
create table public.announcement_subjects (
  announcement_id  uuid not null,
  family_id        uuid not null,
  person_id        uuid not null,
  primary key (announcement_id, person_id),
  foreign key (announcement_id, family_id) references public.announcements(id, family_id) on delete cascade,
  foreign key (person_id, family_id) references public.persons(id, family_id) on delete cascade
);

create table public.announcement_recipients (
  announcement_id  uuid not null,
  family_id        uuid not null,
  user_id          uuid not null,
  emailed_at       timestamptz,
  sms_sent_at      timestamptz,
  read_at          timestamptz,
  primary key (announcement_id, user_id),
  foreign key (announcement_id, family_id) references public.announcements(id, family_id) on delete cascade,
  foreign key (family_id, user_id) references public.members(family_id, user_id) on delete cascade
);
create index announcement_recipients_user_idx on public.announcement_recipients (user_id);

create table public.notification_prefs (
  family_id      uuid not null,
  user_id        uuid not null,
  type           text not null check (type in ('marriage', 'birth', 'event', 'demise', 'general')),
  email_enabled  boolean not null default true,
  primary key (family_id, user_id, type),
  foreign key (family_id, user_id) references public.members(family_id, user_id) on delete cascade,
  constraint demise_always_emailed check (type <> 'demise' or email_enabled)
);

-- ─── Kinship taxonomy ────────────────────────────────────────────────────────
create table public.kinship_terms (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references public.families(id) on delete cascade,
  path                  text not null check (path ~ '^[ey]?[FMSDBZHW](\.[ey]?[FMSDBZHW])*$'),
  side                  text not null default 'none' check (side in ('paternal', 'maternal', 'none')),
  target_gender         text check (target_gender in ('male', 'female')),
  speaker_gender        text check (speaker_gender in ('male', 'female')),
  label_en              text not null,
  label_ta_formal       text,
  label_ta_local        text,
  label_ta_local_roman  text,
  is_verified           boolean not null default false,
  notes                 text,
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now(),
  unique nulls not distinct (family_id, path, speaker_gender),
  check (not is_verified or label_ta_local is not null)
);

create table public.kinship_missing (
  family_id  uuid not null references public.families(id) on delete cascade,
  path       text not null check (path ~ '^[ey]?[FMSDBZHW](\.[ey]?[FMSDBZHW])*$'),
  lookups    integer not null default 1 check (lookups > 0),
  last_seen  timestamptz not null default now(),
  primary key (family_id, path)
);

-- ─── Audit (append-only) ─────────────────────────────────────────────────────
create table public.audit_log (
  id             bigint generated always as identity primary key,
  family_id      uuid,   -- no foreign key: the log must outlive a deleted family and is never updated
  actor_user_id  uuid,
  action         text not null,
  target_table   text,
  target_id      uuid,
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index audit_log_family_idx on public.audit_log (family_id, created_at desc);

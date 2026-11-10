-- =============================================================
-- Nahal CRM — schema
-- One record per person; roles are tags; care status is separate
-- and stored in its own table so it can be hidden by RLS.
-- No medical / psychological details are stored anywhere.
-- =============================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- enums ----------
create type public.app_role as enum (
  'admin',             -- מנהל/ת מערכת
  'manager',           -- מנהל/ת עמותה
  'coordinator',       -- רכז/ת קשרי קהילה
  'cohort_lead',       -- אחראי/ת מחזור או אזור (רואה רק את התחום שלו)
  'donor_coordinator', -- רכז/ת תורמים (לא רואה מידע רווחה)
  'volunteer'          -- מתנדב/ת מורשה (רואה רק את מי שהוקצה לו)
);
create type public.phone_status as enum ('unknown', 'valid', 'invalid');
create type public.interaction_kind as enum ('call', 'meeting', 'message', 'attempt', 'event', 'note');
create type public.interaction_outcome as enum ('talked', 'no_answer', 'rescheduled', 'needs_followup', 'no_contact_requested');
create type public.case_kind as enum ('request', 'concern');
create type public.case_status as enum ('new', 'in_progress', 'waiting', 'resolved');
create type public.case_priority as enum ('normal', 'high', 'urgent');
create type public.task_status as enum ('open', 'done', 'cancelled');

-- ---------- lookups ----------
create table public.cohorts (
  id serial primary key,
  label text not null unique,
  sort_key int not null default 0,
  active boolean not null default true
);

create table public.regions (
  id serial primary key,
  label text not null unique,
  sort_key int not null default 0
);

create table public.contact_types (
  code text primary key,
  label text not null,
  is_sensitive boolean not null default false, -- hidden from roles without care access
  sort_key int not null default 0
);

create table public.care_statuses (
  code text primary key,
  label text not null,
  cadence_days int,              -- default "how are you" frequency for this status
  severity int not null default 0 check (severity between 0 and 3),
  sort_key int not null default 0
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- staff ----------
create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.app_role not null,
  cohort_scope int[] not null default '{}',
  region_scope int[] not null default '{}',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sign-up is only possible for an e-mail an admin invited (enforced by trigger on auth.users).
create table public.staff_invites (
  email text primary key check (email = lower(email)),
  full_name text not null,
  role public.app_role not null,
  cohort_scope int[] not null default '{}',
  region_scope int[] not null default '{}',
  invited_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- contacts ----------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(btrim(first_name)) > 0),
  last_name text not null default '',
  full_name text generated always as (btrim(first_name || ' ' || last_name)) stored,
  phone text check (phone is null or phone ~ '^\+[0-9]{8,15}$'),
  phone_status public.phone_status not null default 'unknown',
  email text check (email is null or email = lower(email)),
  cohort_id int references public.cohorts (id) on delete set null,
  region_id int references public.regions (id) on delete set null,
  city text,
  birth_date date,
  owner_id uuid references public.staff (id) on delete set null,
  profession text,
  skills text[] not null default '{}',
  available_to_help boolean not null default false,
  skills_share_consent boolean not null default false,
  -- Consent is per purpose: operational messages (e.g. "please verify your details") do not
  -- need opt-in; donation / campaign messages by SMS or WhatsApp do (Communications Law s.30A).
  campaign_consent boolean,           -- null = unknown
  campaign_consent_at timestamptz,
  privacy_notice_version text,        -- s.11 notice shown when details were collected
  privacy_notice_at timestamptz,
  notes text check (notes is null or length(notes) <= 2000),
  source text not null default 'manual',
  verified_at timestamptz,            -- when details were last confirmed
  verified_by text check (verified_by in ('self', 'staff')),
  is_demo boolean not null default false,
  archived_at timestamptz,
  merged_into uuid references public.contacts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(first_name || ' ' || last_name || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(city, ''))
  ) stored
);
create index contacts_phone_idx on public.contacts (phone) where merged_into is null;
create index contacts_email_idx on public.contacts (email) where merged_into is null;
create index contacts_cohort_idx on public.contacts (cohort_id);
create index contacts_region_idx on public.contacts (region_id);
create index contacts_owner_idx on public.contacts (owner_id);
create index contacts_search_trgm on public.contacts using gin (search_text extensions.gin_trgm_ops);
create index contacts_name_trgm on public.contacts using gin (full_name extensions.gin_trgm_ops);
create index contacts_skills_idx on public.contacts using gin (skills);

create table public.contact_type_links (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  type_code text not null references public.contact_types (code) on update cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, type_code)
);
create index contact_type_links_type_idx on public.contact_type_links (type_code);

-- Care / follow-up state, separate so it can be hidden from donor staff.
create table public.contact_care (
  contact_id uuid primary key references public.contacts (id) on delete cascade,
  status_code text not null default 'routine' references public.care_statuses (code) on update cascade,
  cadence_days int check (cadence_days is null or cadence_days between 1 and 730),
  last_contact_at timestamptz,
  next_contact_at date,
  snooze_until date,
  updated_at timestamptz not null default now()
);
create index contact_care_next_idx on public.contact_care (next_contact_at);
create index contact_care_status_idx on public.contact_care (status_code);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete set null default auth.uid(),
  kind public.interaction_kind not null,
  outcome public.interaction_outcome,
  context text not null default 'community' check (context in ('community', 'donor')),
  summary text check (summary is null or length(summary) <= 2000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index interactions_contact_idx on public.interactions (contact_id, occurred_at desc);
create index interactions_occurred_idx on public.interactions (occurred_at);

-- ---------- cases: requests and concern reports ----------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity unique,
  kind public.case_kind not null default 'request',
  contact_id uuid references public.contacts (id) on delete set null,
  subject_name text,          -- concern about someone not (yet) matched to a contact
  requester_name text,
  requester_phone text,
  requester_email text,
  preferred_channel text,
  preferred_time text,
  message text check (message is null or length(message) <= 4000),
  source text not null default 'staff',
  category text,
  status public.case_status not null default 'new',
  priority public.case_priority not null default 'normal',
  assignee_id uuid references public.staff (id) on delete set null,
  opened_at timestamptz not null default now(),
  due_at timestamptz not null,       -- filled by trigger from settings when not given
  last_activity_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  is_demo boolean not null default false
);
create index cases_status_idx on public.cases (status, due_at);
create index cases_contact_idx on public.cases (contact_id);
create index cases_assignee_idx on public.cases (assignee_id);
create index cases_phone_idx on public.cases (requester_phone, opened_at);

create table public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete set null default auth.uid(),
  kind text not null check (kind in ('created', 'note', 'call', 'assign', 'status', 'resolved', 'reopened')),
  body text check (body is null or length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index case_events_case_idx on public.case_events (case_id, created_at);

-- ---------- tasks ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  contact_id uuid references public.contacts (id) on delete cascade,
  case_id uuid references public.cases (id) on delete cascade,
  assignee_id uuid references public.staff (id) on delete set null,
  due_date date,
  priority public.case_priority not null default 'normal',
  status public.task_status not null default 'open',
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.staff (id) on delete set null
);
create index tasks_assignee_idx on public.tasks (assignee_id, status, due_date);
create index tasks_contact_idx on public.tasks (contact_id);

-- ---------- fallen, memorials, events ----------
create table public.fallen (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  cohort_id int references public.cohorts (id) on delete set null,
  death_date date not null,
  after_sunset boolean not null default false, -- Hebrew date starts at sunset
  notes text check (notes is null or length(notes) <= 2000),
  owner_id uuid references public.staff (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.fallen_family (
  fallen_id uuid not null references public.fallen (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  relation text,
  primary key (fallen_id, contact_id)
);
create index fallen_family_contact_idx on public.fallen_family (contact_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  cohort_id int references public.cohorts (id) on delete set null,
  region_id int references public.regions (id) on delete set null,
  description text,
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index events_starts_idx on public.events (starts_at);

-- ---------- donors ----------
create table public.campaigns (
  id serial primary key,
  name text not null unique,
  goal_amount numeric(12, 2),
  starts_on date,
  ends_on date,
  description text
);

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'ILS',
  donated_at date not null,
  method text,
  campaign_id int references public.campaigns (id) on delete set null,
  is_recurring boolean not null default false,
  external_ref text unique,
  notes text,
  import_batch_id uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index donations_contact_idx on public.donations (contact_id);
create index donations_date_idx on public.donations (donated_at);

-- ---------- data quality / self-update ----------
create table public.not_duplicates (
  a uuid not null references public.contacts (id) on delete cascade,
  b uuid not null references public.contacts (id) on delete cascade,
  marked_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

create table public.update_links (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_count int not null default 0,
  last_used_at timestamptz,
  revoked boolean not null default false
);
create index update_links_contact_idx on public.update_links (contact_id);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contacts', 'donations')),
  file_name text,
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  rows_total int not null default 0,
  created_count int not null default 0,
  updated_count int not null default 0,
  skipped_count int not null default 0,
  report jsonb
);

-- ---------- audit ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text,
  record_id text,
  changes jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

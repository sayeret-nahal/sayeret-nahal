-- Nahal CRM DEV setup: all migrations + 3,000 fictional demo people + test-account invites.
-- Run ONCE on the EMPTY dev project. Never on production.

-- ===== supabase/migrations/0001_schema.sql =====
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


-- ===== supabase/migrations/0002_security.sql =====
-- =============================================================
-- Nahal CRM — access control (RLS), audit log, privileges
-- Principle: need-to-know. Every policy requires an active staff
-- row (and MFA when settings.require_mfa = true).
-- =============================================================

-- ---------- helper functions (security definer: they bypass RLS to avoid recursion) ----------
create or replace function public.setting_value(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.settings where key = p_key
$$;

create or replace function public.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.settings where key = p_key), p_default)
$$;

create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.staff where id = auth.uid() and is_active
$$;

create or replace function public.my_cohort_scope()
returns int[] language sql stable security definer set search_path = '' as $$
  select coalesce((select cohort_scope from public.staff where id = auth.uid() and is_active), '{}')
$$;

create or replace function public.my_region_scope()
returns int[] language sql stable security definer set search_path = '' as $$
  select coalesce((select region_scope from public.staff where id = auth.uid() and is_active), '{}')
$$;

-- Active staff member, and MFA (aal2) when the organisation requires it.
create or replace function public.is_staff_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where id = auth.uid() and is_active)
     and (
       coalesce((select (value #>> '{}')::boolean from public.settings where key = 'require_mfa'), true) = false
       or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     )
$$;

create or replace function public.can_see_care()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff_ok()
     and public.my_role() in ('admin', 'manager', 'coordinator', 'cohort_lead', 'volunteer')
$$;

create or replace function public.can_manage_donors()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff_ok() and public.my_role() in ('admin', 'manager', 'donor_coordinator')
$$;

-- Is a contact visible to the current user? (single source of truth for child tables)
create or replace function public.can_view_contact(p_contact uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff_ok() and exists (
    select 1 from public.contacts c
    where c.id = p_contact
      and (
        public.my_role() in ('admin', 'manager', 'coordinator')
        or c.owner_id = auth.uid()
        or (public.my_role() = 'cohort_lead'
            and (c.cohort_id = any (public.my_cohort_scope()) or c.region_id = any (public.my_region_scope())))
        or (public.my_role() = 'donor_coordinator'
            and exists (select 1 from public.contact_type_links l where l.contact_id = c.id and l.type_code = 'donor'))
      )
  )
$$;

create or replace function public.is_donor(p_contact uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contact_type_links where contact_id = p_contact and type_code = 'donor')
$$;

-- ---------- privileges: anon gets nothing on tables ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------- enable RLS everywhere ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- not FORCE: the owner (used only by the security-definer helpers below) must bypass RLS
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- lookups ----------
do $$
declare t text;
begin
  foreach t in array array['cohorts', 'regions', 'contact_types', 'care_statuses', 'settings'] loop
    execute format('create policy "%1$s: staff read" on public.%1$I for select to authenticated using ((select public.is_staff_ok()))', t);
    execute format('create policy "%1$s: admin write" on public.%1$I for all to authenticated using ((select public.my_role()) = ''admin'' and (select public.is_staff_ok())) with check ((select public.my_role()) = ''admin'' and (select public.is_staff_ok()))', t);
  end loop;
end $$;

-- the require_mfa / idle settings must be readable before MFA is completed
create policy "settings: own session read" on public.settings for select to authenticated
  using (key in ('require_mfa', 'idle_timeout_minutes', 'org_name') and exists (select 1 from public.staff where id = auth.uid()));

-- ---------- staff ----------
create policy "staff: read self" on public.staff for select to authenticated using (id = (select auth.uid()));
create policy "staff: staff read" on public.staff for select to authenticated using ((select public.is_staff_ok()));
create policy "staff: admin write" on public.staff for update to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()))
  with check ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

create policy "staff_invites: admin" on public.staff_invites for all to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()))
  with check ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

-- ---------- contacts ----------
create policy "contacts: read by scope" on public.contacts for select to authenticated using (
  (select public.is_staff_ok()) and (
    (select public.my_role()) in ('admin', 'manager', 'coordinator')
    or owner_id = (select auth.uid())
    or ((select public.my_role()) = 'cohort_lead'
        and (cohort_id = any (public.my_cohort_scope()) or region_id = any (public.my_region_scope())))
    or ((select public.my_role()) = 'donor_coordinator' and public.is_donor(id))
  )
);
create policy "contacts: insert" on public.contacts for insert to authenticated with check (
  (select public.is_staff_ok()) and (select public.my_role()) <> 'volunteer'
);
create policy "contacts: update by scope" on public.contacts for update to authenticated
  using ((select public.my_role()) <> 'volunteer' and public.can_view_contact(id))
  with check (
    (select public.my_role()) <> 'volunteer' and (select public.is_staff_ok()) and (
      (select public.my_role()) in ('admin', 'manager', 'coordinator')
      or owner_id = (select auth.uid())
      or ((select public.my_role()) = 'cohort_lead'
          and (cohort_id = any (public.my_cohort_scope()) or region_id = any (public.my_region_scope())))
      or ((select public.my_role()) = 'donor_coordinator' and public.is_donor(id))
    )
  );
create policy "contacts: admin delete" on public.contacts for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

-- ---------- contact type tags (sensitive tags hidden without care access) ----------
create policy "type_links: read" on public.contact_type_links for select to authenticated using (
  public.can_view_contact(contact_id)
  and ((select public.can_see_care()) or not exists (
        select 1 from public.contact_types t where t.code = type_code and t.is_sensitive))
);
create policy "type_links: write" on public.contact_type_links for insert to authenticated with check (
  (select public.my_role()) <> 'volunteer' and public.can_view_contact(contact_id)
  and ((select public.can_see_care()) or not exists (
        select 1 from public.contact_types t where t.code = type_code and t.is_sensitive))
);
create policy "type_links: delete" on public.contact_type_links for delete to authenticated using (
  (select public.my_role()) <> 'volunteer' and public.can_view_contact(contact_id)
  and ((select public.can_see_care()) or not exists (
        select 1 from public.contact_types t where t.code = type_code and t.is_sensitive))
);

-- ---------- care state ----------
create policy "care: read" on public.contact_care for select to authenticated
  using ((select public.can_see_care()) and public.can_view_contact(contact_id));
create policy "care: insert" on public.contact_care for insert to authenticated
  with check ((select public.can_see_care()) and public.can_view_contact(contact_id));
create policy "care: update" on public.contact_care for update to authenticated
  using ((select public.can_see_care()) and public.can_view_contact(contact_id))
  with check ((select public.can_see_care()) and public.can_view_contact(contact_id));

-- ---------- interactions ----------
create policy "interactions: read" on public.interactions for select to authenticated using (
  public.can_view_contact(contact_id) and (
    (context = 'community' and (select public.can_see_care()))
    or (context = 'donor' and (select public.can_manage_donors()))
  )
);
create policy "interactions: insert" on public.interactions for insert to authenticated with check (
  staff_id = (select auth.uid()) and public.can_view_contact(contact_id) and (
    (context = 'community' and (select public.can_see_care()))
    or (context = 'donor' and (select public.can_manage_donors()))
  )
);
create policy "interactions: edit own" on public.interactions for update to authenticated
  using (staff_id = (select auth.uid()) and (select public.is_staff_ok()))
  with check (staff_id = (select auth.uid()) and public.can_view_contact(contact_id));
create policy "interactions: admin delete" on public.interactions for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

-- ---------- cases ----------
create or replace function public.can_view_case(p_contact uuid, p_assignee uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_see_care() and (
    public.my_role() in ('admin', 'manager', 'coordinator')
    or p_assignee = auth.uid()
    or p_created_by = auth.uid()
    or (public.my_role() = 'cohort_lead' and p_contact is not null and public.can_view_contact(p_contact))
  )
$$;

create policy "cases: read" on public.cases for select to authenticated
  using (public.can_view_case(contact_id, assignee_id, created_by));
create policy "cases: insert" on public.cases for insert to authenticated
  with check ((select public.can_see_care()) and (contact_id is null or public.can_view_contact(contact_id)));
create policy "cases: update" on public.cases for update to authenticated
  using (public.can_view_case(contact_id, assignee_id, created_by))
  with check ((select public.can_see_care()) and (contact_id is null or public.can_view_contact(contact_id)));
create policy "cases: admin delete" on public.cases for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

-- case events are append-only
create policy "case_events: read" on public.case_events for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id));
create policy "case_events: insert" on public.case_events for insert to authenticated
  with check (staff_id = (select auth.uid()) and exists (select 1 from public.cases c where c.id = case_id));

-- ---------- tasks ----------
create policy "tasks: read" on public.tasks for select to authenticated using (
  (select public.is_staff_ok()) and (
    assignee_id = (select auth.uid()) or created_by = (select auth.uid())
    or (select public.my_role()) in ('admin', 'manager')
    or (contact_id is not null and (select public.my_role()) in ('coordinator', 'cohort_lead')
        and public.can_view_contact(contact_id))
  )
);
create policy "tasks: insert" on public.tasks for insert to authenticated with check (
  (select public.is_staff_ok()) and (contact_id is null or public.can_view_contact(contact_id))
);
create policy "tasks: update" on public.tasks for update to authenticated using (
  (select public.is_staff_ok()) and (
    assignee_id = (select auth.uid()) or created_by = (select auth.uid())
    or (select public.my_role()) in ('admin', 'manager')
    or (contact_id is not null and (select public.my_role()) in ('coordinator', 'cohort_lead')
        and public.can_view_contact(contact_id))
  )
) with check ((select public.is_staff_ok()) and (contact_id is null or public.can_view_contact(contact_id)));
create policy "tasks: delete" on public.tasks for delete to authenticated using (
  (select public.is_staff_ok()) and (created_by = (select auth.uid()) or (select public.my_role()) = 'admin')
);

-- ---------- fallen & family ----------
create policy "fallen: read" on public.fallen for select to authenticated using ((select public.is_staff_ok()));
create policy "fallen: write" on public.fallen for insert to authenticated
  with check ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'));
create policy "fallen: update" on public.fallen for update to authenticated
  using ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'))
  with check ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'));
create policy "fallen: delete" on public.fallen for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

create policy "fallen_family: read" on public.fallen_family for select to authenticated
  using ((select public.can_see_care()) and public.can_view_contact(contact_id));
create policy "fallen_family: write" on public.fallen_family for all to authenticated
  using ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'))
  with check ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'));

-- ---------- events ----------
create policy "events: read" on public.events for select to authenticated using ((select public.is_staff_ok()));
create policy "events: insert" on public.events for insert to authenticated
  with check ((select public.is_staff_ok()) and (select public.my_role()) <> 'volunteer');
create policy "events: update" on public.events for update to authenticated
  using ((select public.is_staff_ok()) and (select public.my_role()) <> 'volunteer')
  with check ((select public.is_staff_ok()) and (select public.my_role()) <> 'volunteer');
create policy "events: delete" on public.events for delete to authenticated
  using ((select public.is_staff_ok()) and (created_by = (select auth.uid()) or (select public.my_role()) = 'admin'));

-- ---------- donors ----------
create policy "campaigns: donors staff" on public.campaigns for all to authenticated
  using ((select public.can_manage_donors())) with check ((select public.can_manage_donors()));
create policy "donations: read" on public.donations for select to authenticated using ((select public.can_manage_donors()));
create policy "donations: insert" on public.donations for insert to authenticated with check ((select public.can_manage_donors()));
create policy "donations: update" on public.donations for update to authenticated
  using ((select public.can_manage_donors())) with check ((select public.can_manage_donors()));
create policy "donations: admin delete" on public.donations for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

-- ---------- data quality ----------
create policy "not_duplicates: managers" on public.not_duplicates for all to authenticated
  using ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'))
  with check ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator'));

create policy "update_links: read" on public.update_links for select to authenticated
  using (public.can_view_contact(contact_id));

create policy "import_batches: importers" on public.import_batches for all to authenticated
  using ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator', 'donor_coordinator'))
  with check ((select public.is_staff_ok()) and (select public.my_role()) in ('admin', 'manager', 'coordinator', 'donor_coordinator'));

-- ---------- audit log: append-only, admin read ----------
create policy "audit: admin read" on public.audit_log for select to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));
revoke insert, update, delete, truncate on public.audit_log from authenticated;

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_key text := coalesce(tg_argv[0], 'id');
  v_id text;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    v_id := to_jsonb(new) ->> v_key;
  elsif tg_op = 'UPDATE' then
    v_id := to_jsonb(new) ->> v_key;
    select jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)) into v_changes
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'search_text', 'full_name', 'last_activity_at');
    if v_changes is null then
      return new;
    end if;
  else
    v_id := to_jsonb(old) ->> v_key;
    v_changes := to_jsonb(old);
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_changes);
  return coalesce(new, old);
end $$;

create trigger audit_contacts after insert or update or delete on public.contacts for each row execute function public.audit_trigger();
create trigger audit_contact_care after update or delete on public.contact_care for each row execute function public.audit_trigger('contact_id');
create trigger audit_type_links after insert or delete on public.contact_type_links for each row execute function public.audit_trigger('contact_id');
create trigger audit_interactions after insert or update or delete on public.interactions for each row execute function public.audit_trigger();
create trigger audit_cases after insert or update or delete on public.cases for each row execute function public.audit_trigger();
create trigger audit_tasks after delete on public.tasks for each row execute function public.audit_trigger();
create trigger audit_donations after insert or update or delete on public.donations for each row execute function public.audit_trigger();
create trigger audit_staff after insert or update or delete on public.staff for each row execute function public.audit_trigger();
create trigger audit_staff_invites after insert or update or delete on public.staff_invites for each row execute function public.audit_trigger('email');
create trigger audit_settings after insert or update or delete on public.settings for each row execute function public.audit_trigger('key');
create trigger audit_fallen after insert or update or delete on public.fallen for each row execute function public.audit_trigger();
create trigger audit_fallen_family after insert or delete on public.fallen_family for each row execute function public.audit_trigger('contact_id');
create trigger audit_care_statuses after insert or update or delete on public.care_statuses for each row execute function public.audit_trigger('code');
create trigger audit_contact_types after insert or update or delete on public.contact_types for each row execute function public.audit_trigger('code');
create trigger audit_update_links after insert or update on public.update_links for each row execute function public.audit_trigger();

-- Read access / exports / logins are logged by the app through this function.
create or replace function public.log_access(p_action text, p_table text default null, p_record text default null, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'not allowed';
  end if;
  if p_action not in ('view', 'export', 'login', 'logout', 'mfa_verified', 'report', 'search') then
    raise exception 'unknown action';
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id, changes)
  values (auth.uid(), p_action, p_table, p_record, p_details);
end $$;

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch_contacts before update on public.contacts for each row execute function public.touch_updated_at();
create trigger touch_contact_care before update on public.contact_care for each row execute function public.touch_updated_at();
create trigger touch_settings before update on public.settings for each row execute function public.touch_updated_at();


-- ===== supabase/migrations/0003_logic.sql =====
-- =============================================================
-- Nahal CRM — business logic: check-in cadence, cases & SLA,
-- search, duplicates & merge, public forms, reports
-- =============================================================

-- ---------- phone normalisation (mirrors src/lib/phone.ts) ----------
create or replace function public.normalize_il_phone(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9+]', '', 'g');
  if d = '' then return null; end if;
  if left(d, 1) = '+' then
    d := regexp_replace(d, '[^0-9]', '', 'g');
    if left(d, 3) <> '972' then
      if length(d) between 8 and 15 then return '+' || d; end if;
      return null;
    end if;
  end if;
  d := regexp_replace(d, '[^0-9]', '', 'g');
  if left(d, 5) = '00972' then d := substr(d, 3); end if;
  if left(d, 3) = '972' then d := substr(d, 4); end if;
  if left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) between 8 and 9 then return '+972' || d; end if;
  return null;
end $$;

-- ---------- check-in cadence ----------
create or replace function public.effective_cadence(p_status text, p_override int)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(p_override, (select cadence_days from public.care_statuses where code = p_status), 90)
$$;

-- New contact → care row. First call is spread over the cadence so an import of
-- 3,000 people does not make everyone "due today".
create or replace function public.contact_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cad int := public.effective_cadence('routine', null);
begin
  insert into public.contact_care (contact_id, status_code, next_contact_at)
  values (new.id, 'routine', current_date + 1 + floor(random() * v_cad)::int)
  on conflict (contact_id) do nothing;
  return new;
end $$;
create trigger contact_after_insert after insert on public.contacts
  for each row execute function public.contact_after_insert();

-- Status / cadence change → bring the next call forward if the new cadence is shorter.
create or replace function public.care_before_update()
returns trigger language plpgsql set search_path = '' as $$
declare v_due date;
begin
  if new.status_code is distinct from old.status_code or new.cadence_days is distinct from old.cadence_days then
    v_due := coalesce(new.last_contact_at::date, current_date)
             + public.effective_cadence(new.status_code, new.cadence_days);
    if new.next_contact_at is null or v_due < new.next_contact_at then
      new.next_contact_at := greatest(v_due, current_date);
    end if;
  end if;
  return new;
end $$;
create trigger care_before_update before update on public.contact_care
  for each row execute function public.care_before_update();

-- Log a call / meeting / message and schedule the next "how are you".
create or replace function public.log_interaction(
  p_contact uuid,
  p_kind public.interaction_kind,
  p_outcome public.interaction_outcome default null,
  p_summary text default null,
  p_next date default null,
  p_occurred timestamptz default now(),
  p_context text default 'community'
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_reached boolean;
  v_care public.contact_care;
  v_next date;
begin
  insert into public.interactions (contact_id, staff_id, kind, outcome, summary, occurred_at, context)
  values (p_contact, auth.uid(), p_kind, p_outcome, nullif(btrim(p_summary), ''), coalesce(p_occurred, now()), p_context)
  returning id into v_id;

  if p_context = 'community' and p_kind <> 'note' then
    select * into v_care from public.contact_care where contact_id = p_contact;
    if found then
      v_reached := p_outcome in ('talked', 'needs_followup', 'no_contact_requested')
                   or (p_outcome is null and p_kind in ('meeting', 'event', 'message'));
      v_next := coalesce(p_next, case p_outcome
        when 'no_answer' then current_date + 3
        when 'rescheduled' then current_date + 2
        when 'no_contact_requested' then current_date + 90
        else current_date + public.effective_cadence(v_care.status_code, v_care.cadence_days)
      end);
      update public.contact_care set
        last_contact_at = case when v_reached then greatest(coalesce(last_contact_at, p_occurred), coalesce(p_occurred, now())) else last_contact_at end,
        next_contact_at = v_next,
        snooze_until = case when p_outcome = 'no_contact_requested' then v_next else null end
      where contact_id = p_contact;
    end if;

    if p_outcome = 'needs_followup' then
      insert into public.tasks (title, contact_id, assignee_id, due_date, priority)
      values ('המשך טיפול אחרי שיחה', p_contact, auth.uid(), current_date + 3, 'high');
    end if;
  end if;
  return v_id;
end $$;

-- ---------- cases: SLA, events, guard rails ----------
create or replace function public.case_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.due_at is null then
    new.due_at := case
      when new.source = 'talk_form' then now() + make_interval(hours => public.setting_int('talk_response_hours', 24))
      when new.kind = 'concern' then now() + make_interval(hours => public.setting_int('concern_response_hours', 48))
      else now() + make_interval(days => public.setting_int('request_sla_days', 7))
    end;
  end if;
  if new.kind = 'concern' and new.priority = 'normal' then
    new.priority := 'high';
  end if;
  if new.assignee_id is not null and new.status = 'new' then
    new.status := 'in_progress';
  end if;
  new.last_activity_at := now();
  return new;
end $$;
create trigger case_before_insert before insert on public.cases
  for each row execute function public.case_before_insert();

create or replace function public.case_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.case_events (case_id, staff_id, kind, body)
  values (new.id, auth.uid(), 'created', null);
  return new;
end $$;
create trigger case_after_insert after insert on public.cases
  for each row execute function public.case_after_insert();

create or replace function public.case_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    if new.resolution is null or length(btrim(new.resolution)) < 3 then
      raise exception 'אי אפשר לסגור פנייה בלי לתעד מה נעשה' using errcode = 'P0001';
    end if;
    new.resolved_at := now();
  elsif new.status <> 'resolved' and old.status = 'resolved' then
    new.resolved_at := null;
  end if;
  if new.assignee_id is not null and old.assignee_id is null and new.status = 'new' then
    new.status := 'in_progress';
  end if;
  if new.status is distinct from old.status or new.assignee_id is distinct from old.assignee_id then
    new.last_activity_at := now();
  end if;
  return new;
end $$;
create trigger case_before_update before update on public.cases
  for each row execute function public.case_before_update();

create or replace function public.case_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.case_events (case_id, staff_id, kind, body)
    values (new.id, auth.uid(), 'assign',
            coalesce((select full_name from public.staff where id = new.assignee_id), 'ללא אחראי'));
  end if;
  if new.status is distinct from old.status then
    insert into public.case_events (case_id, staff_id, kind, body)
    values (new.id, auth.uid(),
            case when new.status = 'resolved' then 'resolved'
                 when old.status = 'resolved' then 'reopened' else 'status' end,
            case when new.status = 'resolved' then new.resolution else new.status::text end);
  end if;
  return new;
end $$;
create trigger case_after_update after update on public.cases
  for each row execute function public.case_after_update();

create or replace function public.case_event_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('note', 'call') then
    update public.cases set
      last_activity_at = now(),
      status = case when status = 'new' then 'in_progress'::public.case_status else status end
    where id = new.case_id;
  end if;
  return new;
end $$;
create trigger case_event_after_insert after insert on public.case_events
  for each row execute function public.case_event_after_insert();

-- Red-flag view (respects the caller's RLS)
create or replace view public.case_alerts with (security_invoker = true) as
select
  c.id, c.ref_no, c.kind, c.priority, c.status, c.assignee_id, c.contact_id,
  c.opened_at, c.due_at, c.last_activity_at,
  (c.status <> 'resolved' and c.assignee_id is null) as unassigned,
  (c.status <> 'resolved' and c.due_at < now()) as overdue,
  (c.status <> 'resolved' and c.last_activity_at < now() - interval '7 days') as stalled,
  (c.status = 'resolved' and not exists (
     select 1 from public.case_events e where e.case_id = c.id and e.kind in ('note', 'call'))) as closed_without_action
from public.cases c;

-- ---------- data health ----------
create or replace view public.contact_health with (security_invoker = true) as
select
  c.id as contact_id,
  c.phone is null as missing_phone,
  c.email is null as missing_email,
  c.cohort_id is null as missing_cohort,
  c.region_id is null as missing_region,
  c.owner_id is null as no_owner,
  c.phone_status = 'invalid' as phone_invalid,
  (c.verified_at is null
     or c.verified_at < now() - make_interval(days => public.setting_int('stale_after_days', 365))) as not_verified,
  coalesce((
    select count(*) = 3 and bool_and(x.outcome = 'no_answer')
    from (select i.outcome from public.interactions i
          where i.contact_id = c.id and i.context = 'community' and i.kind in ('call', 'attempt')
          order by i.occurred_at desc limit 3) x
  ), false) as unreachable
from public.contacts c
where c.merged_into is null and c.archived_at is null;

-- ---------- search ----------
create or replace function public.search_contacts(p_q text, p_limit int default 20)
returns table (id uuid, full_name text, phone text, email text, cohort_id int, region_id int, city text, score real)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
begin
  if length(v_q) < 2 then return; end if;
  if left(v_digits, 3) = '972' then v_digits := '0' || substr(v_digits, 4); end if;
  return query
  select c.id, c.full_name, c.phone, c.email, c.cohort_id, c.region_id, c.city,
         greatest(extensions.similarity(lower(c.full_name), v_q),
                  extensions.word_similarity(v_q, c.search_text))::real as score
  from public.contacts c
  left join public.cohorts co on co.id = c.cohort_id
  where c.merged_into is null and c.archived_at is null and (
       c.search_text like '%' || v_q || '%'
    or (length(v_digits) >= 3 and c.phone is not null and ('0' || substr(c.phone, 5)) like '%' || v_digits || '%')
    or extensions.word_similarity(v_q, c.search_text) > 0.45
    or lower(co.label) like '%' || v_q || '%'
  )
  order by (lower(c.full_name) like v_q || '%') desc, score desc, c.full_name
  limit least(greatest(p_limit, 1), 100);
end $$;

-- ---------- duplicates ----------
create or replace function public.find_duplicates(p_limit int default 200)
returns table (a uuid, b uuid, reasons text, score real)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform set_config('pg_trgm.similarity_threshold', '0.75', true);
  return query
  with pairs as (
    select x.id as a, y.id as b, 'אותו טלפון'::text as reason, 1.0::real as score
      from public.contacts x join public.contacts y on x.phone = y.phone and x.id < y.id
     where x.merged_into is null and y.merged_into is null and x.archived_at is null and y.archived_at is null
    union all
    select x.id, y.id, 'אותו דוא"ל', 1.0::real
      from public.contacts x join public.contacts y on x.email = y.email and x.id < y.id
     where x.merged_into is null and y.merged_into is null and x.archived_at is null and y.archived_at is null
    union all
    -- name-only candidates (always need a human check): similar name, compatible cohort,
    -- and not two different known phone numbers
    select x.id, y.id, 'שם דומה', extensions.similarity(x.full_name, y.full_name)::real
      from public.contacts x
      join public.contacts y on y.full_name operator(extensions.%) x.full_name and x.id < y.id
     where x.merged_into is null and y.merged_into is null and x.archived_at is null and y.archived_at is null
       and (x.cohort_id is null or y.cohort_id is null or x.cohort_id = y.cohort_id)
       and not (x.phone is not null and y.phone is not null and x.phone <> y.phone)
  )
  select p.a, p.b, string_agg(distinct p.reason, ', '), max(p.score)::real
  from pairs p
  where not exists (select 1 from public.not_duplicates n where n.a = p.a and n.b = p.b)
  group by p.a, p.b
  order by max(p.score) desc, count(*) desc
  limit p_limit;
end $$;

-- Merge p_drop into p_keep; all history moves; the dropped record is kept (archived) for audit.
create or replace function public.merge_contacts(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.contacts;
  k public.contacts;
begin
  if not public.is_staff_ok() or public.my_role() not in ('admin', 'manager') then
    raise exception 'רק מנהל/ת מערכת או מנהל/ת עמותה יכולים לאחד רשומות';
  end if;
  if p_keep = p_drop then raise exception 'אותה רשומה'; end if;
  select * into k from public.contacts where id = p_keep for update;
  select * into d from public.contacts where id = p_drop for update;
  if k.id is null or d.id is null or k.merged_into is not null or d.merged_into is not null then
    raise exception 'אחת הרשומות לא נמצאה או כבר אוחדה';
  end if;

  update public.contacts set
    last_name = coalesce(nullif(k.last_name, ''), d.last_name),
    phone = coalesce(k.phone, d.phone),
    email = coalesce(k.email, d.email),
    cohort_id = coalesce(k.cohort_id, d.cohort_id),
    region_id = coalesce(k.region_id, d.region_id),
    city = coalesce(k.city, d.city),
    birth_date = coalesce(k.birth_date, d.birth_date),
    owner_id = coalesce(k.owner_id, d.owner_id),
    profession = coalesce(k.profession, d.profession),
    skills = array(select distinct s from unnest(k.skills || d.skills) s),
    available_to_help = k.available_to_help or d.available_to_help,
    skills_share_consent = k.skills_share_consent or d.skills_share_consent,
    campaign_consent = coalesce(k.campaign_consent, d.campaign_consent),
    notes = left(concat_ws(E'\n', k.notes, d.notes,
                 case when d.phone is not null and k.phone is not null and d.phone <> k.phone
                      then 'טלפון נוסף (מאיחוד): ' || d.phone end), 2000),
    verified_at = greatest(k.verified_at, d.verified_at)
  where id = p_keep;

  insert into public.contact_type_links (contact_id, type_code)
    select p_keep, type_code from public.contact_type_links where contact_id = p_drop
    on conflict do nothing;
  update public.interactions set contact_id = p_keep where contact_id = p_drop;
  update public.cases set contact_id = p_keep where contact_id = p_drop;
  update public.tasks set contact_id = p_keep where contact_id = p_drop;
  update public.donations set contact_id = p_keep where contact_id = p_drop;
  insert into public.fallen_family (fallen_id, contact_id, relation)
    select fallen_id, p_keep, relation from public.fallen_family where contact_id = p_drop
    on conflict do nothing;
  delete from public.fallen_family where contact_id = p_drop;
  update public.update_links set revoked = true where contact_id = p_drop;
  delete from public.not_duplicates where a = p_drop or b = p_drop;

  update public.contact_care kc set
    status_code = case when sd.severity > sk.severity then dc.status_code else kc.status_code end,
    next_contact_at = least(kc.next_contact_at, dc.next_contact_at),
    last_contact_at = greatest(kc.last_contact_at, dc.last_contact_at)
  from public.contact_care dc, public.care_statuses sk, public.care_statuses sd
  where kc.contact_id = p_keep and dc.contact_id = p_drop
    and sk.code = kc.status_code and sd.code = dc.status_code;

  update public.contacts set merged_into = p_keep, archived_at = now() where id = p_drop;

  insert into public.audit_log (actor_id, action, table_name, record_id, changes)
  values (auth.uid(), 'merge', 'contacts', p_keep::text, jsonb_build_object('merged', to_jsonb(d)));
end $$;

-- ---------- staff onboarding: only invited e-mails can sign up ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare inv public.staff_invites;
begin
  select * into inv from public.staff_invites where email = lower(new.email);
  if not found then
    raise exception 'ההרשמה מותרת רק לכתובות שהוזמנו על ידי מנהל/ת המערכת';
  end if;
  insert into public.staff (id, email, full_name, role, cohort_scope, region_scope)
  values (new.id, lower(new.email), inv.full_name, inv.role, inv.cohort_scope, inv.region_scope);
  delete from public.staff_invites where email = inv.email;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- self-update links ----------
create or replace function public.create_update_link(p_contact uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.can_view_contact(p_contact) then
    raise exception 'אין הרשאה';
  end if;
  update public.update_links set revoked = true where contact_id = p_contact and not revoked;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.update_links (contact_id, token_hash, created_by)
  values (p_contact, extensions.digest(v_token, 'sha256'), auth.uid());
  return v_token;
end $$;

create or replace function public.resolve_update_token(p_token text)
returns uuid language sql stable security definer set search_path = '' as $$
  select contact_id from public.update_links
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and not revoked and expires_at > now()
$$;

-- ---------- public RPCs (anon) ----------
create or replace function public.public_form_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.settings
  where key in ('org_name', 'talk_response_text', 'emergency_text', 'privacy_notice_text',
                'privacy_notice_version', 'talk_response_hours')
$$;

create or replace function public.check_public_rate(p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.cases where requester_phone = p_phone and opened_at > now() - interval '1 hour') >= 3 then
    raise exception 'התקבלו כבר כמה פניות ממספר זה בשעה האחרונה. נחזור אליך בהקדם.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.cases where source in ('talk_form', 'concern_form') and opened_at > now() - interval '1 hour') >= 40 then
    raise exception 'המערכת עמוסה כרגע. נסו שוב בעוד כמה דקות. אם יש סכנה מיידית — חייגו 101, ולתמיכה נפשית מיידית ער"ן 1201.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.match_contact_by_phone(p_phone text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(id::text)::uuid end
  from public.contacts where phone = p_phone and merged_into is null and archived_at is null
$$;

create or replace function public.submit_talk_request(
  p_name text, p_phone text, p_channel text, p_preferred_time text, p_message text, p_hp text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_il_phone(p_phone);
  v_ref bigint;
begin
  if coalesce(p_hp, '') <> '' then return 0; end if; -- bot honeypot
  if length(btrim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב שם' using errcode = 'P0001'; end if;
  if v_phone is null then raise exception 'מספר הטלפון לא תקין' using errcode = 'P0001'; end if;
  if coalesce(p_channel, '') not in ('phone', 'whatsapp', 'sms') then raise exception 'נא לבחור איך לחזור אליך' using errcode = 'P0001'; end if;
  if length(coalesce(p_message, '')) > 2000 or length(coalesce(p_preferred_time, '')) > 200 then
    raise exception 'ההודעה ארוכה מדי' using errcode = 'P0001';
  end if;
  perform public.check_public_rate(v_phone);

  insert into public.cases (kind, category, source, priority, contact_id, requester_name, requester_phone,
                            preferred_channel, preferred_time, message, created_by)
  values ('request', 'talk', 'talk_form', 'urgent', public.match_contact_by_phone(v_phone), btrim(p_name), v_phone,
          p_channel, nullif(btrim(p_preferred_time), ''), nullif(btrim(p_message), ''), null)
  returning ref_no into v_ref;
  return v_ref;
end $$;

create or replace function public.submit_concern(
  p_reporter_name text, p_reporter_phone text, p_subject_name text, p_subject_phone text,
  p_subject_cohort text, p_message text, p_hp text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_rphone text := public.normalize_il_phone(p_reporter_phone);
  v_sphone text := public.normalize_il_phone(p_subject_phone);
  v_ref bigint;
begin
  if coalesce(p_hp, '') <> '' then return 0; end if;
  if length(btrim(coalesce(p_reporter_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב את שמך' using errcode = 'P0001'; end if;
  if v_rphone is null then raise exception 'מספר הטלפון שלך לא תקין' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_subject_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב את שם החבר' using errcode = 'P0001'; end if;
  if length(coalesce(p_message, '')) > 2000 or length(coalesce(p_subject_cohort, '')) > 80 then
    raise exception 'הטקסט ארוך מדי' using errcode = 'P0001';
  end if;
  perform public.check_public_rate(v_rphone);

  insert into public.cases (kind, category, source, priority, contact_id, subject_name, requester_name,
                            requester_phone, message, created_by)
  values ('concern', 'concern', 'concern_form', 'high', public.match_contact_by_phone(v_sphone),
          btrim(p_subject_name) || coalesce(' · ' || nullif(btrim(p_subject_cohort), ''), '')
            || coalesce(' · ' || v_sphone, ''),
          btrim(p_reporter_name), v_rphone, nullif(btrim(p_message), ''), null)
  returning ref_no into v_ref;
  return v_ref;
end $$;

create or replace function public.get_update_profile(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := public.resolve_update_token(p_token);
  r public.contacts;
begin
  if v_id is null then return null; end if;
  select * into r from public.contacts where id = v_id and merged_into is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'first_name', r.first_name, 'last_name', r.last_name,
    'phone', case when r.phone like '+972%' then '0' || substr(r.phone, 5) else r.phone end,
    'email', r.email, 'city', r.city, 'region_id', r.region_id,
    'profession', r.profession, 'skills', to_jsonb(r.skills),
    'available_to_help', r.available_to_help, 'skills_share_consent', r.skills_share_consent,
    'campaign_consent', r.campaign_consent,
    'regions', (select jsonb_agg(jsonb_build_object('id', id, 'label', label) order by sort_key, label) from public.regions)
  );
end $$;

create or replace function public.submit_update_profile(p_token text, p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := public.resolve_update_token(p_token);
  v_phone text;
  v_email text;
  v_skills text[];
begin
  if v_id is null then raise exception 'הקישור אינו בתוקף. אפשר לבקש קישור חדש מהעמותה.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_data ->> 'first_name', ''))) not between 1 and 60 then raise exception 'נא לכתוב שם פרטי' using errcode = 'P0001'; end if;
  v_phone := public.normalize_il_phone(p_data ->> 'phone');
  if nullif(btrim(coalesce(p_data ->> 'phone', '')), '') is not null and v_phone is null then
    raise exception 'מספר הטלפון לא תקין' using errcode = 'P0001';
  end if;
  v_email := lower(nullif(btrim(coalesce(p_data ->> 'email', '')), ''));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'כתובת הדוא"ל לא תקינה' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct left(btrim(s), 40)) filter (where btrim(s) <> ''), '{}')
    into v_skills
    from jsonb_array_elements_text(coalesce(p_data -> 'skills', '[]'::jsonb)) s;
  if cardinality(v_skills) > 20 then raise exception 'יותר מדי כישורים' using errcode = 'P0001'; end if;

  update public.contacts set
    first_name = left(btrim(p_data ->> 'first_name'), 60),
    last_name = left(btrim(coalesce(p_data ->> 'last_name', last_name)), 60),
    phone = coalesce(v_phone, phone),
    phone_status = case when v_phone is not null then 'valid'::public.phone_status else phone_status end,
    email = v_email,
    city = left(nullif(btrim(coalesce(p_data ->> 'city', '')), ''), 60),
    region_id = case when (p_data ->> 'region_id') ~ '^[0-9]+$'
                      and exists (select 1 from public.regions where id = (p_data ->> 'region_id')::int)
                     then (p_data ->> 'region_id')::int else region_id end,
    profession = left(nullif(btrim(coalesce(p_data ->> 'profession', '')), ''), 80),
    skills = v_skills,
    available_to_help = coalesce((p_data ->> 'available_to_help')::boolean, false),
    skills_share_consent = coalesce((p_data ->> 'skills_share_consent')::boolean, false),
    campaign_consent = (p_data ->> 'campaign_consent')::boolean,
    campaign_consent_at = now(),
    privacy_notice_version = (select value #>> '{}' from public.settings where key = 'privacy_notice_version'),
    privacy_notice_at = now(),
    verified_at = now(),
    verified_by = 'self'
  where id = v_id;

  update public.update_links set used_count = used_count + 1, last_used_at = now()
  where token_hash = extensions.digest(p_token, 'sha256');

  insert into public.interactions (contact_id, staff_id, kind, context, summary)
  values (v_id, null, 'note', 'community', 'עדכן/ה פרטים בעצמו/ה דרך קישור אישי');
  return true;
end $$;

-- ---------- impact report (aggregates only, no personal data) ----------
create or replace function public.impact_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  -- period boundaries are Israel midnight, whatever the server time zone is
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Jerusalem';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Jerusalem';
begin
  if not public.is_staff_ok() or public.my_role() not in ('admin', 'manager', 'coordinator', 'donor_coordinator') then
    raise exception 'אין הרשאה לדוחות';
  end if;
  return jsonb_build_object(
    'community_size', (select count(*) from public.contacts where merged_into is null and archived_at is null),
    'people_reached', (select count(distinct contact_id) from public.interactions
                        where context = 'community' and occurred_at >= v_from and occurred_at < v_to
                          and (outcome in ('talked', 'needs_followup') or (outcome is null and kind in ('meeting', 'event', 'message')))),
    'calls_made', (select count(*) from public.interactions
                    where context = 'community' and kind in ('call', 'attempt') and occurred_at >= v_from and occurred_at < v_to),
    'calls_talked', (select count(*) from public.interactions
                      where context = 'community' and kind = 'call' and outcome in ('talked', 'needs_followup')
                        and occurred_at >= v_from and occurred_at < v_to),
    'meetings', (select count(*) from public.interactions
                  where context = 'community' and kind = 'meeting' and occurred_at >= v_from and occurred_at < v_to),
    'cases_opened', (select count(*) from public.cases where opened_at >= v_from and opened_at < v_to),
    'cases_resolved', (select count(*) from public.cases where resolved_at >= v_from and resolved_at < v_to),
    'cases_resolved_on_time', (select count(*) from public.cases where resolved_at >= v_from and resolved_at < v_to and resolved_at <= due_at),
    'talk_requests', (select count(*) from public.cases where source = 'talk_form' and opened_at >= v_from and opened_at < v_to),
    'volunteers', (select count(*) from public.contact_type_links l join public.contacts c on c.id = l.contact_id
                    where l.type_code = 'volunteer' and c.merged_into is null and c.archived_at is null),
    'helpers_available', (select count(*) from public.contacts where available_to_help and merged_into is null and archived_at is null),
    'events_held', (select count(*) from public.events where starts_at >= v_from and starts_at < v_to),
    'donations_count', (select count(*) from public.donations where donated_at >= p_from and donated_at <= p_to),
    'donations_sum', (select coalesce(sum(amount), 0) from public.donations where currency = 'ILS' and donated_at >= p_from and donated_at <= p_to),
    'donors_unique', (select count(distinct contact_id) from public.donations where donated_at >= p_from and donated_at <= p_to),
    'includes_demo', (select exists (select 1 from public.contacts where is_demo)
                          or exists (select 1 from public.cases where is_demo)
                          or exists (select 1 from public.events where is_demo)
                          or exists (select 1 from public.donations where is_demo)
                          or exists (select 1 from public.fallen where is_demo))
  );
end $$;

-- ---------- function privileges ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function
  public.public_form_settings(),
  public.submit_talk_request(text, text, text, text, text, text),
  public.submit_concern(text, text, text, text, text, text, text),
  public.get_update_profile(text),
  public.submit_update_profile(text, jsonb)
to anon;
alter default privileges in schema public revoke execute on functions from public, anon;


-- ===== supabase/migrations/0004_reference_data.sql =====
-- =============================================================
-- Nahal CRM — reference data (editable later by an admin)
-- Labels and cadences are working assumptions to be confirmed
-- with the association (see docs/02-product-spec.md).
-- =============================================================

insert into public.contact_types (code, label, is_sensitive, sort_key) values
  ('reservist',   'לוחם/ת מילואים',   false, 10),
  ('alumni',      'יוצא/ת הסיירת',    false, 20),
  ('wounded',     'פצוע/ה',           true,  30),
  ('support',     'בליווי מיוחד',     true,  40), -- neutral label, no diagnosis (replaces "PTSD")
  ('bereaved',    'משפחה שכולה',      true,  50),
  ('donor',       'תורם/ת',           false, 60),
  ('volunteer',   'מתנדב/ת',          false, 70);

insert into public.care_statuses (code, label, cadence_days, severity, sort_key) values
  ('distress',    'במצוקה',        7,   3, 10),
  ('close',       'מעקב צמוד',     14,  2, 20),
  ('follow_up',   'נדרש מעקב',     30,  1, 30),
  ('rehab',       'בשיקום',        30,  1, 40),
  ('routine',     'בשגרה',         90,  0, 50),
  ('good',        'בקשר תקין',     180, 0, 60),
  ('lost',        'נותק הקשר',     90,  1, 70);

insert into public.regions (label, sort_key) values
  ('צפון', 10), ('חיפה והקריות', 20), ('עמקים', 30), ('שרון', 40), ('מרכז', 50),
  ('תל אביב', 60), ('ירושלים', 70), ('שפלה', 80), ('דרום', 90), ('יהודה ושומרון', 100), ('חו"ל', 110);

insert into public.settings (key, value) values
  ('org_name', '"עמותת סיירת נחל"'),
  ('require_mfa', 'true'),               -- production must keep this true
  ('idle_timeout_minutes', '30'),
  ('stale_after_days', '365'),
  ('request_sla_days', '7'),
  ('talk_response_hours', '24'),
  ('concern_response_hours', '48'),
  ('talk_response_text', '"נחזור אליך תוך 24 שעות, בדרך כלל מוקדם יותר. בשבתות ובחגים ייתכן עיכוב."'),
  ('emergency_text', '"אם יש סכנה מיידית לחיים — חייגו 101 (מד\"א) או 100 (משטרה). לתמיכה נפשית מיידית, 24/7: ער\"ן 1201."'),
  ('privacy_notice_version', '"draft-2026-11"'),
  ('privacy_notice_text', '"המידע נאסף על ידי עמותת סיירת נחל כדי לשמור איתך על קשר ולסייע לך. מסירת המידע אינה חובה. המידע לא יועבר לגורם אחר ללא הסכמתך, ותוכל/י לעיין בו ולבקש לתקנו בכל עת. (נוסח טיוטה — טעון אישור משפטי)"');


-- ===== supabase/migrations/0005_hardening.sql =====
-- =============================================================
-- Nahal CRM — security hardening after the independent review
-- (H = high, M = medium, L = low in docs/04-security-privacy.md)
-- =============================================================

-- ---------- H1: import reports visible only to their creator and managers ----------
drop policy "import_batches: importers" on public.import_batches;
create policy "import_batches: read own or managers" on public.import_batches for select to authenticated using (
  (select public.is_staff_ok()) and (created_by = (select auth.uid()) or (select public.my_role()) in ('admin', 'manager'))
);
create policy "import_batches: insert own" on public.import_batches for insert to authenticated with check (
  (select public.is_staff_ok()) and created_by = (select auth.uid())
  and (select public.my_role()) in ('admin', 'manager', 'coordinator', 'donor_coordinator')
);
create policy "import_batches: update own" on public.import_batches for update to authenticated
  using ((select public.is_staff_ok()) and created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- ---------- H2 + M4: public forms never shut down; phone matches are only suggestions ----------
alter table public.cases add column suspected_spam boolean not null default false;
alter table public.cases add column suggested_contact_id uuid references public.contacts (id) on delete set null;

drop function public.check_public_rate(text);
-- Per phone: hard limit. Global volume: never reject (that would let anyone close the channel),
-- only flag the submission so staff can tell a flood apart from real requests.
create or replace function public.public_rate_check(p_phone text, p_source text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.cases where requester_phone = p_phone and opened_at > now() - interval '1 hour') >= 3 then
    raise exception 'התקבלו כבר כמה פניות ממספר זה בשעה האחרונה. נחזור אליך בהקדם.' using errcode = 'P0001';
  end if;
  return (select count(*) from public.cases where source = p_source and opened_at > now() - interval '1 hour') >= 30;
end $$;

create or replace function public.submit_talk_request(
  p_name text, p_phone text, p_channel text, p_preferred_time text, p_message text, p_hp text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_il_phone(p_phone);
  v_spam boolean;
  v_ref bigint;
begin
  if coalesce(p_hp, '') <> '' then return 0; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב שם' using errcode = 'P0001'; end if;
  if v_phone is null then raise exception 'מספר הטלפון לא תקין' using errcode = 'P0001'; end if;
  if coalesce(p_channel, '') not in ('phone', 'whatsapp', 'sms') then raise exception 'נא לבחור איך לחזור אליך' using errcode = 'P0001'; end if;
  if length(coalesce(p_message, '')) > 2000 or length(coalesce(p_preferred_time, '')) > 200 then
    raise exception 'ההודעה ארוכה מדי' using errcode = 'P0001';
  end if;
  v_spam := public.public_rate_check(v_phone, 'talk_form');
  insert into public.cases (kind, category, source, priority, suggested_contact_id, requester_name, requester_phone,
                            preferred_channel, preferred_time, message, created_by, suspected_spam)
  values ('request', 'talk', 'talk_form', 'urgent', public.match_contact_by_phone(v_phone), btrim(p_name), v_phone,
          p_channel, nullif(btrim(p_preferred_time), ''), nullif(btrim(p_message), ''), null, v_spam)
  returning ref_no into v_ref;
  return v_ref;
end $$;

create or replace function public.submit_concern(
  p_reporter_name text, p_reporter_phone text, p_subject_name text, p_subject_phone text,
  p_subject_cohort text, p_message text, p_hp text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_rphone text := public.normalize_il_phone(p_reporter_phone);
  v_sphone text := public.normalize_il_phone(p_subject_phone);
  v_spam boolean;
  v_ref bigint;
begin
  if coalesce(p_hp, '') <> '' then return 0; end if;
  if length(btrim(coalesce(p_reporter_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב את שמך' using errcode = 'P0001'; end if;
  if v_rphone is null then raise exception 'מספר הטלפון שלך לא תקין' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_subject_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב את שם החבר' using errcode = 'P0001'; end if;
  if length(coalesce(p_message, '')) > 2000 or length(coalesce(p_subject_cohort, '')) > 80 then
    raise exception 'הטקסט ארוך מדי' using errcode = 'P0001';
  end if;
  v_spam := public.public_rate_check(v_rphone, 'concern_form');
  insert into public.cases (kind, category, source, priority, suggested_contact_id, subject_name, requester_name,
                            requester_phone, message, created_by, suspected_spam)
  values ('concern', 'concern', 'concern_form', 'high', public.match_contact_by_phone(v_sphone),
          btrim(p_subject_name) || coalesce(' · ' || nullif(btrim(p_subject_cohort), ''), '') || coalesce(' · ' || v_sphone, ''),
          btrim(p_reporter_name), v_rphone, nullif(btrim(p_message), ''), null, v_spam)
  returning ref_no into v_ref;
  return v_ref;
end $$;

-- ---------- M2: clients cannot set demo / merge / archive / source; cohort leads stay in scope ----------
revoke insert, update on public.contacts from authenticated;
grant insert (id, first_name, last_name, phone, phone_status, email, cohort_id, region_id, city, birth_date, owner_id,
              profession, skills, available_to_help, skills_share_consent, campaign_consent, campaign_consent_at,
              privacy_notice_version, privacy_notice_at, notes, source, verified_at, verified_by)
  on public.contacts to authenticated;
grant update (first_name, last_name, phone, phone_status, email, cohort_id, region_id, city, birth_date, owner_id,
              profession, skills, available_to_help, skills_share_consent, campaign_consent, campaign_consent_at,
              privacy_notice_version, privacy_notice_at, notes, verified_at, verified_by)
  on public.contacts to authenticated;

create or replace function public.contact_scope_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if; -- migrations, seed, security-definer RPCs
  if public.my_role() = 'cohort_lead'
     and (new.cohort_id, new.region_id, new.owner_id) is distinct from (old.cohort_id, old.region_id, old.owner_id)
     and not coalesce(new.cohort_id = any (public.my_cohort_scope()) or new.region_id = any (public.my_region_scope()), false) then
    raise exception 'אפשר לשייך רק למחזורים או לאזורים שבאחריותך' using errcode = 'P0001';
  end if;
  if public.my_role() = 'donor_coordinator'
     and (new.cohort_id, new.region_id) is distinct from (old.cohort_id, old.region_id) then
    raise exception 'שינוי מחזור או אזור נעשה על ידי רכז/ת הקהילה' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger contact_scope_guard before update on public.contacts
  for each row execute function public.contact_scope_guard();

create or replace function public.set_contact_archived(p_contact uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff_ok() or public.my_role() not in ('admin', 'manager') then
    raise exception 'רק מנהל/ת מערכת או מנהל/ת עמותה יכולים להעביר לארכיון';
  end if;
  update public.contacts set archived_at = case when p_archived then now() end
  where id = p_contact and merged_into is null;
end $$;

-- ---------- M3: attribution cannot be forged; history only via triggers ----------
drop policy "cases: insert" on public.cases;
create policy "cases: insert" on public.cases for insert to authenticated with check (
  (select public.can_see_care()) and created_by = (select auth.uid())
  and (contact_id is null or public.can_view_contact(contact_id))
);

create or replace function public.case_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := old.created_by;
  if auth.uid() is not null and new.contact_id is distinct from old.contact_id and old.contact_id is not null
     and public.my_role() not in ('admin', 'manager', 'coordinator') then
    raise exception 'רק רכז/ת או מנהל/ת יכולים לשנות את האדם שהפנייה מקושרת אליו' using errcode = 'P0001';
  end if;
  if new.contact_id is not null and new.contact_id is distinct from old.contact_id then
    new.suggested_contact_id := null;
  end if;
  return new;
end $$;
create trigger case_guard before update on public.cases for each row execute function public.case_guard();

drop policy "case_events: insert" on public.case_events;
create policy "case_events: insert" on public.case_events for insert to authenticated with check (
  staff_id = (select auth.uid()) and kind in ('note', 'call') and exists (select 1 from public.cases c where c.id = case_id)
);

drop policy "tasks: insert" on public.tasks;
create policy "tasks: insert" on public.tasks for insert to authenticated with check (
  (select public.is_staff_ok()) and created_by = (select auth.uid())
  and (contact_id is null or public.can_view_contact(contact_id))
  and (case_id is null or exists (select 1 from public.cases c where c.id = case_id))
);

create or replace function public.task_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := old.created_by;
  if new.status is distinct from old.status then
    new.completed_by := case when new.status = 'open' then null else auth.uid() end;
    new.completed_at := case when new.status = 'open' then null else now() end;
  else
    new.completed_by := old.completed_by;
    new.completed_at := old.completed_at;
  end if;
  return new;
end $$;
create trigger task_guard before update on public.tasks for each row execute function public.task_guard();

-- events: only the creator or managers edit; creator is immutable
drop policy "events: update" on public.events;
drop policy "events: delete" on public.events;
create policy "events: update" on public.events for update to authenticated
  using ((select public.is_staff_ok()) and (created_by = (select auth.uid()) or (select public.my_role()) in ('admin', 'manager')))
  with check ((select public.is_staff_ok()));
create policy "events: delete" on public.events for delete to authenticated
  using ((select public.is_staff_ok()) and (created_by = (select auth.uid()) or (select public.my_role()) in ('admin', 'manager')));
create or replace function public.keep_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := old.created_by;
  return new;
end $$;
create trigger events_keep_creator before update on public.events for each row execute function public.keep_created_by();

-- campaigns: donor staff manage, only admin deletes
drop policy "campaigns: donors staff" on public.campaigns;
create policy "campaigns: read" on public.campaigns for select to authenticated using ((select public.can_manage_donors()));
create policy "campaigns: insert" on public.campaigns for insert to authenticated with check ((select public.can_manage_donors()));
create policy "campaigns: update" on public.campaigns for update to authenticated
  using ((select public.can_manage_donors())) with check ((select public.can_manage_donors()));
create policy "campaigns: admin delete" on public.campaigns for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));

-- ---------- L7: fallen records (and their notes) only for roles that work with families ----------
drop policy "fallen: read" on public.fallen;
create policy "fallen: read" on public.fallen for select to authenticated using ((select public.can_see_care()));

-- ---------- L1: internal helpers are not callable from the API ----------
revoke execute on function public.match_contact_by_phone(text) from public, anon, authenticated;
revoke execute on function public.public_rate_check(text, text) from public, anon, authenticated;
revoke execute on function public.resolve_update_token(text) from public, anon, authenticated;
revoke execute on function public.setting_value(text) from public, anon, authenticated;
grant execute on function public.set_contact_archived(uuid, boolean) to authenticated;
revoke execute on function public.set_contact_archived(uuid, boolean) from public, anon;
revoke execute on function public.contact_scope_guard(), public.case_guard(), public.task_guard(), public.keep_created_by() from public, anon, authenticated;

-- ---------- L2: the access log cannot be flooded or forged ----------
create or replace function public.log_access(p_action text, p_table text default null, p_record text default null, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('view', 'export', 'login', 'logout', 'mfa_verified', 'report', 'search') then
    raise exception 'unknown action';
  end if;
  if p_action in ('login', 'logout') then
    if not exists (select 1 from public.staff where id = auth.uid()) then raise exception 'not allowed'; end if;
  elsif p_action = 'mfa_verified' then
    if not exists (select 1 from public.staff where id = auth.uid() and is_active)
       or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'not allowed'; end if;
  elsif not public.is_staff_ok() then
    raise exception 'not allowed';
  end if;
  if p_details is not null and length(p_details::text) > 4000 then
    raise exception 'details too large';
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id, changes)
  values (auth.uid(), p_action, left(p_table, 60), left(p_record, 100), p_details);
end $$;

-- ---------- L3: audit the remaining tables ----------
create trigger audit_case_events after insert on public.case_events for each row execute function public.audit_trigger();
create trigger audit_events after insert or update or delete on public.events for each row execute function public.audit_trigger();
create trigger audit_campaigns after insert or update or delete on public.campaigns for each row execute function public.audit_trigger();
create trigger audit_import_batches after insert on public.import_batches for each row execute function public.audit_trigger();
create trigger audit_not_duplicates after insert or delete on public.not_duplicates for each row execute function public.audit_trigger('a');
drop trigger audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function public.audit_trigger();
create trigger audit_contact_care_insert after insert on public.contact_care for each row execute function public.audit_trigger('contact_id');

-- ---------- L4: self-update links are short-lived and limited ----------
alter table public.update_links alter column expires_at set default (now() + interval '14 days');
create or replace function public.resolve_update_token(p_token text)
returns uuid language sql stable security definer set search_path = '' as $$
  select contact_id from public.update_links
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and not revoked and expires_at > now() and used_count < 3
$$;
revoke execute on function public.resolve_update_token(text) from public, anon, authenticated;

create or replace function public.create_update_link(p_contact uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.can_view_contact(p_contact) or public.my_role() = 'volunteer' then
    raise exception 'אין הרשאה';
  end if;
  update public.update_links set revoked = true where contact_id = p_contact and not revoked;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.update_links (contact_id, token_hash, created_by)
  values (p_contact, extensions.digest(v_token, 'sha256'), auth.uid());
  return v_token;
end $$;

-- ---------- L8: donor staff get donation metrics only ----------
create or replace function public.impact_report_safe(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := public.impact_report(p_from, p_to);
begin
  if public.my_role() = 'donor_coordinator' then
    r := r - array['people_reached', 'calls_made', 'calls_talked', 'meetings', 'cases_opened',
                   'cases_resolved', 'cases_resolved_on_time', 'talk_requests'];
  end if;
  return r;
end $$;
revoke execute on function public.impact_report(date, date) from public, anon, authenticated;
grant execute on function public.impact_report_safe(date, date) to authenticated;
revoke execute on function public.impact_report_safe(date, date) from public, anon;

-- the red-flag view also exposes the new columns
create or replace view public.case_alerts with (security_invoker = true) as
select
  c.id, c.ref_no, c.kind, c.priority, c.status, c.assignee_id, c.contact_id,
  c.opened_at, c.due_at, c.last_activity_at,
  (c.status <> 'resolved' and c.assignee_id is null) as unassigned,
  (c.status <> 'resolved' and c.due_at < now()) as overdue,
  (c.status <> 'resolved' and c.last_activity_at < now() - interval '7 days') as stalled,
  (c.status = 'resolved' and not exists (
     select 1 from public.case_events e where e.case_id = c.id and e.kind in ('note', 'call'))) as closed_without_action,
  c.suspected_spam
from public.cases c;


-- ===== supabase/migrations/0006_case_assignee_roles.sql =====
-- A request or concern can only be assigned to someone who is allowed to see it
-- (donor staff have no access to care data, so a case assigned to them would vanish).
create or replace function public.case_assignee_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (select 1 from public.staff s where s.id = new.assignee_id and s.is_active
                     and s.role in ('admin', 'manager', 'coordinator', 'cohort_lead', 'volunteer')) then
    raise exception 'אפשר להקצות פנייה רק לאיש/אשת צוות שמורשה לראות פניות' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger case_assignee_check before insert or update on public.cases
  for each row execute function public.case_assignee_check();
revoke execute on function public.case_assignee_check() from public, anon, authenticated;


-- ===== supabase/migrations/0007_fallen_details.sql =====
-- 0007: memorial details for the unit's fallen, and who in the community is connected to each one.
-- Every detail comes from a source (normally the Ministry of Defense "Yizkor" page) that is stored with the record.

alter table public.fallen
  add column rank text check (rank is null or length(rank) <= 60),
  add column sub_unit text check (sub_unit is null or length(sub_unit) <= 120),     -- e.g. פלס"ר נח"ל, עורב נח"ל, פלחה"ן נח"ל
  add column residence text check (residence is null or length(residence) <= 120),   -- home town / kibbutz
  add column burial_place text check (burial_place is null or length(burial_place) <= 200),
  add column war_operation text check (war_operation is null or length(war_operation) <= 200),
  add column enlistment_text text check (enlistment_text is null or length(enlistment_text) <= 60), -- as written in the source
  add column enlistment_year int check (enlistment_year is null or enlistment_year between 1940 and 2100),
  add column source_url text check (source_url is null or source_url ~ '^https://'),
  add column source_note text check (source_note is null or length(source_note) <= 2000);

create index fallen_cohort_idx on public.fallen (cohort_id);

-- Place names are written in many ways ("קיבוץ כפר עזה" / "כפר עזה", "תל אביב-יפו" / "תל אביב").
create or replace function public.norm_place(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(btrim(coalesce(p, '')), '^(קיבוץ|מושב|מושבה|היישוב|יישוב|העיר|הכפר|כפר הנוער)\s+', ''),
        '[-־–]\s*יפו$|["״''׳]', '', 'g'),
      '\s+', ' ', 'g'),
    '')
$$;

create index contacts_city_norm_idx on public.contacts (public.norm_place(city));

-- People connected to a fallen soldier: served in the same cohort, or live in the same town.
-- security_invoker: each user only sees the contacts and fallen their own role allows.
create or replace view public.fallen_connections with (security_invoker = true) as
  select f.id as fallen_id, c.id as contact_id, 'cohort'::text as reason
    from public.fallen f join public.contacts c on c.cohort_id = f.cohort_id
   where f.cohort_id is not null and c.archived_at is null
  union all
  select f.id, c.id, 'city'
    from public.fallen f join public.contacts c on public.norm_place(c.city) = public.norm_place(f.residence)
   where public.norm_place(f.residence) is not null and c.archived_at is null;

grant select on public.fallen_connections to authenticated;


-- ===== supabase/migrations/0008_pink_list.sql =====
-- 0008: "הרשימה הורודה" — people who used the association's discounts or community services
-- but are not active paying members. Membership in the list is a contact type ('pink'); whether the
-- person is an active payer is derived from donations, so someone who starts paying drops off by itself.

insert into public.contact_types (code, label, is_sensitive, sort_key)
values ('pink', 'הרשימה הורודה', false, 65)
on conflict (code) do nothing;

-- how far back a payment still counts as "active" (months; editable by an admin in settings)
insert into public.settings (key, value) values ('active_payer_months', '12')
on conflict (key) do nothing;

-- Last payment date, kept on the contact so every role that may see the person can see whether they
-- pay, without seeing donation amounts (donations themselves stay restricted to donor roles).
alter table public.contacts add column last_paid_at date;

create or replace function public.sync_last_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  ids := array_remove(array[
    case when tg_op in ('INSERT', 'UPDATE') then new.contact_id end,
    case when tg_op in ('UPDATE', 'DELETE') then old.contact_id end], null);
  update public.contacts c
     set last_paid_at = (select max(d.donated_at) from public.donations d where d.contact_id = c.id)
   where c.id = any(ids);
  return null;
end $$;
revoke execute on function public.sync_last_paid() from public, anon, authenticated;

create trigger donations_sync_last_paid
  after insert or update of contact_id, donated_at or delete on public.donations
  for each row execute function public.sync_last_paid();

update public.contacts c
   set last_paid_at = d.last
  from (select contact_id, max(donated_at) last from public.donations group by contact_id) d
 where d.contact_id = c.id;


-- ===== supabase/migrations/0009_integrations.sql =====
-- 0009: external integrations
--   * payments (JGive, Grow)      → the payer becomes an association member + a donation is recorded
--   * consumer club (Nexus)       → a purchase through our link is recorded as use of the association's services
--   * website inquiries           → a case routed by topic to the right staff member
--   * WhatsApp/SMS broadcasts (019) with consent, opt-out and delivery tracking
-- Server-side code reaches the write paths only through security-definer functions that require a
-- shared ingest secret (kept in Vercel env, its hash here); browsers and the anon key cannot use them.

-- ---------------------------------------------------------------- reference data
insert into public.contact_types (code, label, is_sensitive, sort_key)
values ('member', 'חבר/ת עמותה', false, 15)
on conflict (code) do nothing;

alter table public.contacts add column member_since date;

alter table public.donations
  add column source text not null default 'manual' check (source in ('manual', 'import', 'jgive', 'grow', 'demo')),
  add column refunded_at timestamptz;

-- refunded payments no longer count as payments
create or replace function public.sync_last_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  ids := array_remove(array[
    case when tg_op in ('INSERT', 'UPDATE') then new.contact_id end,
    case when tg_op in ('UPDATE', 'DELETE') then old.contact_id end], null);
  update public.contacts c
     set last_paid_at = (select max(d.donated_at) from public.donations d where d.contact_id = c.id and d.refunded_at is null)
   where c.id = any(ids);
  return null;
end $$;
drop trigger donations_sync_last_paid on public.donations;
create trigger donations_sync_last_paid
  after insert or update of contact_id, donated_at, refunded_at or delete on public.donations
  for each row execute function public.sync_last_paid();

-- ---------------------------------------------------------------- secrets (no API access at all)
create table public.integration_secrets (
  name text primary key,
  secret_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from public, anon, authenticated;

create or replace function public.check_ingest_secret(p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or length(p_secret) < 24 or not exists (
    select 1 from public.integration_secrets
     where name = 'ingest' and secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  ) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end $$;
revoke execute on function public.check_ingest_secret(text) from public, anon, authenticated;

-- Admin sets (or rotates) the secret; only its hash is stored.
create or replace function public.set_ingest_secret(p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not ((select public.my_role()) = 'admin' and (select public.is_staff_ok())) then
    raise exception 'רק מנהל/ת מערכת' using errcode = '42501';
  end if;
  if length(coalesce(p_secret, '')) < 32 then raise exception 'secret too short'; end if;
  insert into public.integration_secrets (name, secret_hash)
  values ('ingest', encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
  on conflict (name) do update set secret_hash = excluded.secret_hash, updated_at = now();
end $$;
revoke execute on function public.set_ingest_secret(text) from public, anon;

-- ---------------------------------------------------------------- event log
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('jgive', 'grow', 'nexus', 'whatsapp', 'website')),
  kind text not null,                         -- payment, refund, purchase, status, inbound, ...
  external_id text not null,
  status text not null default 'processed' check (status in ('processed', 'duplicate', 'ignored', 'error')),
  contact_id uuid references public.contacts (id) on delete set null,
  created_contact boolean not null default false,
  summary text,
  error text,
  payload jsonb,
  received_at timestamptz not null default now(),
  unique (provider, kind, external_id)
);
create index integration_events_recent_idx on public.integration_events (provider, received_at desc);
alter table public.integration_events enable row level security;
create policy "integration_events: admin read" on public.integration_events for select to authenticated
  using ((select public.my_role()) in ('admin', 'manager') and (select public.is_staff_ok()));
revoke insert, update, delete on public.integration_events from authenticated;
revoke all on public.integration_events from anon;

-- ---------------------------------------------------------------- benefit usage (consumer club etc.)
create table public.benefit_usages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  provider text not null check (provider in ('nexus', 'manual')),
  used_at date not null,
  description text check (description is null or length(description) <= 300),
  amount numeric(12, 2),
  external_ref text unique,
  created_at timestamptz not null default now()
);
create index benefit_usages_contact_idx on public.benefit_usages (contact_id, used_at desc);
alter table public.benefit_usages enable row level security;
create policy "benefit_usages: read" on public.benefit_usages for select to authenticated
  using ((select public.is_staff_ok()) and public.can_view_contact(contact_id));
create policy "benefit_usages: admin delete" on public.benefit_usages for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));
revoke insert, update on public.benefit_usages from authenticated;
revoke all on public.benefit_usages from anon;
create trigger audit_benefit_usages after insert or delete on public.benefit_usages
  for each row execute function public.audit_trigger('contact_id');

-- ---------------------------------------------------------------- contact matching
-- Finds a person by phone, then e-mail; creates one when nobody matches. Returns (id, created).
create or replace function public.ingest_find_or_create_contact(
  p_full_name text, p_first text, p_last text, p_phone text, p_email text, p_source text
) returns table (contact_id uuid, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_il_phone(p_phone);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_first text := nullif(btrim(coalesce(p_first, '')), '');
  v_last text := nullif(btrim(coalesce(p_last, '')), '');
  v_id uuid;
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
  if v_phone is not null then v_id := public.match_contact_by_phone(v_phone); end if;
  if v_id is null and v_email is not null then
    select c.id into v_id from public.contacts c
     where c.email = v_email and c.merged_into is null and c.archived_at is null
     order by c.created_at limit 1;
  end if;
  if v_id is not null then
    -- fill gaps only; never overwrite what staff entered
    update public.contacts c set
      phone = coalesce(c.phone, v_phone),
      email = coalesce(c.email, v_email)
    where c.id = v_id;
    return query select v_id, false;
    return;
  end if;
  if v_first is null and v_last is null then
    v_first := split_part(btrim(coalesce(p_full_name, '')), ' ', 1);
    v_last := nullif(btrim(substr(btrim(coalesce(p_full_name, '')), length(v_first) + 1)), '');
  end if;
  if coalesce(v_first, '') = '' then v_first := coalesce(v_email, v_phone, 'ללא שם'); end if;
  if v_phone is null and v_email is null then
    raise exception 'missing phone and email' using errcode = 'P0001';
  end if;
  insert into public.contacts (first_name, last_name, phone, email, source)
  values (left(v_first, 60), left(coalesce(v_last, ''), 60), v_phone, v_email, p_source)
  returning id into v_id;
  return query select v_id, true;
end $$;
revoke execute on function public.ingest_find_or_create_contact(text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.add_contact_type(p_contact uuid, p_type text)
returns void language sql security definer set search_path = '' as $$
  insert into public.contact_type_links (contact_id, type_code) values (p_contact, p_type) on conflict do nothing;
$$;
revoke execute on function public.add_contact_type(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- payments (JGive / Grow)
-- p_event (normalized by the server):
--   external_id, kind ('payment' | 'refund'), full_name, first_name, last_name, phone, email,
--   amount, currency, paid_at (date), recurring (bool), campaign, marketing_consent (bool | null), raw (jsonb)
create or replace function public.ingest_payment(p_secret text, p_provider text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ext text := nullif(btrim(p_event ->> 'external_id'), '');
  v_kind text := coalesce(p_event ->> 'kind', 'payment');
  v_amount numeric := nullif(p_event ->> 'amount', '')::numeric;
  v_paid date := coalesce(nullif(p_event ->> 'paid_at', '')::date, (now() at time zone 'Asia/Jerusalem')::date);
  v_event uuid;
  v_contact uuid;
  v_created boolean;
  v_ref text;
begin
  perform public.check_ingest_secret(p_secret);
  if p_provider not in ('jgive', 'grow') then raise exception 'unknown provider'; end if;
  if v_ext is null then raise exception 'missing external_id' using errcode = 'P0001'; end if;
  v_ref := p_provider || ':' || v_ext;

  insert into public.integration_events (provider, kind, external_id, payload)
  values (p_provider, v_kind, v_ext, p_event -> 'raw')
  on conflict (provider, kind, external_id) do nothing
  returning id into v_event;
  if v_event is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  begin
    if v_kind = 'refund' then
      update public.donations set refunded_at = now() where external_ref = v_ref and refunded_at is null
      returning contact_id into v_contact;
      update public.integration_events set contact_id = v_contact,
             status = case when v_contact is null then 'ignored' else 'processed' end,
             summary = case when v_contact is null then 'החזר לתשלום שלא נמצא במערכת' else 'החזר כספי' end
       where id = v_event;
      return jsonb_build_object('status', 'processed', 'contact_id', v_contact);
    end if;

    if v_amount is null or v_amount <= 0 then raise exception 'invalid amount' using errcode = 'P0001'; end if;

    select f.contact_id, f.created into v_contact, v_created
      from public.ingest_find_or_create_contact(p_event ->> 'full_name', p_event ->> 'first_name', p_event ->> 'last_name',
                                                p_event ->> 'phone', p_event ->> 'email', p_provider) f;

    insert into public.donations (contact_id, amount, currency, donated_at, method, is_recurring, external_ref, notes, source)
    values (v_contact, v_amount, upper(coalesce(nullif(p_event ->> 'currency', ''), 'ILS')), v_paid,
            case p_provider when 'jgive' then 'JGive' else 'Grow' end,
            coalesce((p_event ->> 'recurring')::boolean, false), v_ref,
            nullif(left(p_event ->> 'campaign', 300), ''), p_provider)
    on conflict (external_ref) do nothing;

    perform public.add_contact_type(v_contact, 'member');
    perform public.add_contact_type(v_contact, 'donor');
    update public.contacts set member_since = least(coalesce(member_since, v_paid), v_paid) where id = v_contact;
    if (p_event ->> 'marketing_consent')::boolean is true then
      update public.contacts set campaign_consent = true, campaign_consent_at = now()
       where id = v_contact and campaign_consent is distinct from false; -- never override an opt-out
    end if;

    update public.integration_events set contact_id = v_contact, created_contact = v_created,
           summary = format('%s ₪%s%s', case when v_created then 'חבר/ה חדש/ה ·' else 'תשלום ·' end, v_amount,
                            case when coalesce((p_event ->> 'recurring')::boolean, false) then ' · הוראת קבע' else '' end)
     where id = v_event;
    return jsonb_build_object('status', 'processed', 'contact_id', v_contact, 'created', v_created);
  exception when others then
    update public.integration_events set status = 'error', error = left(sqlerrm, 500) where id = v_event;
    return jsonb_build_object('status', 'error', 'error', sqlerrm);
  end;
end $$;
revoke execute on function public.ingest_payment(text, text, jsonb) from public;
grant execute on function public.ingest_payment(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- consumer-club purchases (Nexus)
-- p_event: external_id, full_name/first_name/last_name, phone, email, used_at, description, amount, raw
create or replace function public.ingest_benefit_usage(p_secret text, p_provider text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ext text := nullif(btrim(p_event ->> 'external_id'), '');
  v_used date := coalesce(nullif(p_event ->> 'used_at', '')::date, (now() at time zone 'Asia/Jerusalem')::date);
  v_event uuid;
  v_contact uuid;
  v_created boolean;
begin
  perform public.check_ingest_secret(p_secret);
  if p_provider <> 'nexus' then raise exception 'unknown provider'; end if;
  if v_ext is null then raise exception 'missing external_id' using errcode = 'P0001'; end if;

  insert into public.integration_events (provider, kind, external_id, payload)
  values (p_provider, 'purchase', v_ext, p_event -> 'raw')
  on conflict (provider, kind, external_id) do nothing
  returning id into v_event;
  if v_event is null then return jsonb_build_object('status', 'duplicate'); end if;

  begin
    select f.contact_id, f.created into v_contact, v_created
      from public.ingest_find_or_create_contact(p_event ->> 'full_name', p_event ->> 'first_name', p_event ->> 'last_name',
                                                p_event ->> 'phone', p_event ->> 'email', p_provider) f;
    insert into public.benefit_usages (contact_id, provider, used_at, description, amount, external_ref)
    values (v_contact, p_provider, v_used, nullif(left(p_event ->> 'description', 300), ''),
            nullif(p_event ->> 'amount', '')::numeric, p_provider || ':' || v_ext)
    on conflict (external_ref) do nothing;
    perform public.add_contact_type(v_contact, 'pink');
    update public.integration_events set contact_id = v_contact, created_contact = v_created,
           summary = coalesce(nullif(left(p_event ->> 'description', 120), ''), 'רכישה במועדון')
     where id = v_event;
    return jsonb_build_object('status', 'processed', 'contact_id', v_contact, 'created', v_created);
  exception when others then
    update public.integration_events set status = 'error', error = left(sqlerrm, 500) where id = v_event;
    return jsonb_build_object('status', 'error', 'error', sqlerrm);
  end;
end $$;
revoke execute on function public.ingest_benefit_usage(text, text, jsonb) from public;
grant execute on function public.ingest_benefit_usage(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- website inquiries
create table public.inquiry_topics (
  code text primary key check (code ~ '^[a-z_]{2,30}$'),
  label text not null check (length(label) between 2 and 60),
  description text check (description is null or length(description) <= 200),
  priority public.case_priority not null default 'normal',
  assignee_id uuid references public.staff (id) on delete set null,
  active boolean not null default true,
  sort_key int not null default 0
);
alter table public.inquiry_topics enable row level security;
create policy "inquiry_topics: staff read" on public.inquiry_topics for select to authenticated using ((select public.is_staff_ok()));
create policy "inquiry_topics: admin write" on public.inquiry_topics for all to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()))
  with check ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));
revoke all on public.inquiry_topics from anon;

insert into public.inquiry_topics (code, label, description, priority, sort_key) values
  ('welfare',     'רווחה וסיוע',              'סיוע כלכלי, דיור, משפחה, מיצוי זכויות',          'high',   10),
  ('wounded',     'פצועים ונפגעים',            'ליווי פצועים, נפגעי פעולות איבה ופוסט-טראומה',   'high',   20),
  ('social',      'רכז/ת חברתי/ת',             'מפגשים, אירועים, מחזורים וקהילה',                'normal', 30),
  ('employment',  'תעסוקה וקריירה',            'חיפוש עבודה, הכוונה, לימודים',                   'normal', 40),
  ('bereaved',    'משפחות שכולות',             'קשר עם המשפחות והנצחה',                          'high',   50),
  ('membership',  'חברות בעמותה',              'הצטרפות, דמי חבר והטבות',                        'normal', 60),
  ('donations',   'תרומות ושותפויות',          'תרומה, חסות ושיתופי פעולה',                      'normal', 70),
  ('volunteering','התנדבות',                   'רוצה לעזור ולהתנדב',                             'normal', 80),
  ('other',       'אחר',                       null,                                             'normal', 90)
on conflict (code) do nothing;

alter table public.cases
  add column requester_consent boolean,      -- agreed to receive updates (marketing consent) in the form
  add column origin_page text check (origin_page is null or length(origin_page) <= 300);

-- topics for the public form (only active ones, only public fields)
create or replace function public.public_inquiry_topics()
returns table (code text, label text, description text)
language sql stable security definer set search_path = '' as $$
  select code, label, description from public.inquiry_topics where active order by sort_key, label;
$$;
grant execute on function public.public_inquiry_topics() to anon, authenticated;

create or replace function public.submit_inquiry(
  p_topic text, p_name text, p_phone text, p_email text, p_message text,
  p_consent boolean default false, p_page text default null, p_hp text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_topic public.inquiry_topics;
  v_phone text := public.normalize_il_phone(p_phone);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_spam boolean;
  v_ref bigint;
begin
  if coalesce(p_hp, '') <> '' then return 0; end if;
  select * into v_topic from public.inquiry_topics where code = p_topic and active;
  if not found then raise exception 'נא לבחור נושא' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'נא לכתוב שם' using errcode = 'P0001'; end if;
  if v_phone is null then raise exception 'מספר הטלפון לא תקין' using errcode = 'P0001'; end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'כתובת הדוא״ל לא תקינה' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_message, ''))) < 2 then raise exception 'נא לכתוב במה אפשר לעזור' using errcode = 'P0001'; end if;
  if length(p_message) > 2000 then raise exception 'ההודעה ארוכה מדי' using errcode = 'P0001'; end if;
  v_spam := public.public_rate_check(v_phone, 'website_form');
  insert into public.cases (kind, category, source, priority, suggested_contact_id, requester_name, requester_phone,
                            requester_email, preferred_channel, message, assignee_id, created_by, suspected_spam,
                            requester_consent, origin_page)
  values ('request', v_topic.code, 'website', v_topic.priority, public.match_contact_by_phone(v_phone), btrim(p_name),
          v_phone, v_email, 'phone', btrim(p_message),
          (select s.id from public.staff s where s.id = v_topic.assignee_id and s.is_active), null, v_spam,
          coalesce(p_consent, false), nullif(left(btrim(coalesce(p_page, '')), 300), ''))
  returning ref_no into v_ref;
  return v_ref;
end $$;
revoke execute on function public.submit_inquiry(text, text, text, text, text, boolean, text, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, boolean, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- broadcasts (WhatsApp / SMS via 019)
create table public.message_templates (
  id serial primary key,
  name text not null unique check (length(name) between 2 and 80),
  channel text not null check (channel in ('whatsapp', 'sms')),
  provider_template text,                 -- the 019 template id (WhatsApp templates are created and approved on 019's site)
  language text not null default 'he',
  category text not null default 'marketing' check (category in ('marketing', 'utility')),
  body text not null check (length(body) between 2 and 1000),   -- {{1}}, {{2}} … variables
  variables text[] not null default '{}' check (coalesce(array_length(variables, 1), 0) <= 5), -- what fills {{1}}..{{5}}: first_name, full_name, cohort, city, custom
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 2 and 120),
  template_id int not null references public.message_templates (id),
  custom_values text[] not null default '{}',
  filters jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'queued', 'sending', 'sent', 'cancelled')),
  audience_count int,
  skipped_no_consent int,
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  approved_by uuid references public.staff (id) on delete set null,
  scheduled_at timestamptz,
  queued_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.broadcast_recipients (
  id bigint generated always as identity primary key,
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  phone text not null,
  vars text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (broadcast_id, contact_id)
);
create index broadcast_recipients_queue_idx on public.broadcast_recipients (status, broadcast_id);
create index broadcast_recipients_msg_idx on public.broadcast_recipients (provider_message_id);

alter table public.message_templates enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
revoke all on public.message_templates, public.broadcasts, public.broadcast_recipients from anon;

create or replace function public.can_broadcast()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff_ok() and public.my_role() in ('admin', 'manager', 'coordinator', 'donor_coordinator');
$$;
create or replace function public.can_send_broadcast()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff_ok() and public.my_role() in ('admin', 'manager');
$$;

create policy "templates: read" on public.message_templates for select to authenticated using ((select public.can_broadcast()));
create policy "templates: admin write" on public.message_templates for all to authenticated
  using ((select public.my_role()) in ('admin', 'manager') and (select public.is_staff_ok()))
  with check ((select public.my_role()) in ('admin', 'manager') and (select public.is_staff_ok()));
create policy "broadcasts: read" on public.broadcasts for select to authenticated using ((select public.can_broadcast()));
create policy "broadcasts: draft insert" on public.broadcasts for insert to authenticated
  with check ((select public.can_broadcast()) and status = 'draft' and approved_by is null);
create policy "broadcasts: draft update" on public.broadcasts for update to authenticated
  using ((select public.can_broadcast()) and status = 'draft')
  with check ((select public.can_broadcast()) and status in ('draft', 'cancelled') and approved_by is null);
create policy "broadcasts: draft delete" on public.broadcasts for delete to authenticated
  using ((select public.can_broadcast()) and status = 'draft');
create policy "recipients: read" on public.broadcast_recipients for select to authenticated using ((select public.can_send_broadcast()));
revoke insert, update, delete on public.broadcast_recipients from authenticated;

create trigger audit_broadcasts after insert or update or delete on public.broadcasts for each row execute function public.audit_trigger();

-- Audience: people with a usable phone who agreed to receive messages, matching the filters.
-- filters: { types: [..], cohort_ids: [..], region_ids: [..], city: text, pink: bool, members_active: bool }
-- security invoker: when staff preview an audience, their own visibility rules apply.
create or replace function public.broadcast_audience(p_filters jsonb)
returns table (contact_id uuid, phone text, first_name text, full_name text, cohort text, city text, consented boolean)
language sql stable set search_path = '' as $$
  with cutoff as (
    select (now() at time zone 'Asia/Jerusalem')::date
           - (coalesce((select (value #>> '{}')::int from public.settings where key = 'active_payer_months'), 12) * interval '1 month') as d
  )
  select c.id, c.phone, c.first_name, c.full_name, co.label, c.city, coalesce(c.campaign_consent, false)
    from public.contacts c
    left join public.cohorts co on co.id = c.cohort_id
   where c.archived_at is null and c.merged_into is null
     and c.phone is not null and c.phone_status <> 'invalid'
     and (coalesce(jsonb_array_length(p_filters -> 'types'), 0) = 0 or exists (
          select 1 from public.contact_type_links l where l.contact_id = c.id
             and l.type_code in (select jsonb_array_elements_text(p_filters -> 'types'))))
     and (coalesce(jsonb_array_length(p_filters -> 'cohort_ids'), 0) = 0
          or c.cohort_id in (select (jsonb_array_elements_text(p_filters -> 'cohort_ids'))::int))
     and (coalesce(jsonb_array_length(p_filters -> 'region_ids'), 0) = 0
          or c.region_id in (select (jsonb_array_elements_text(p_filters -> 'region_ids'))::int))
     and (coalesce(p_filters ->> 'city', '') = '' or public.norm_place(c.city) = public.norm_place(p_filters ->> 'city'))
     and (coalesce((p_filters ->> 'pink')::boolean, false) = false or (
          exists (select 1 from public.contact_type_links l where l.contact_id = c.id and l.type_code = 'pink')
          and (c.last_paid_at is null or c.last_paid_at < (select d from cutoff))))
     and (coalesce((p_filters ->> 'members_active')::boolean, false) = false or (
          exists (select 1 from public.contact_type_links l where l.contact_id = c.id and l.type_code = 'member')
          and c.last_paid_at >= (select d from cutoff)));
$$;
revoke execute on function public.broadcast_audience(jsonb) from public, anon;
grant execute on function public.broadcast_audience(jsonb) to authenticated;

-- Approve and queue: freezes the recipient list (only people who consented) and the variable values.
create or replace function public.queue_broadcast(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.broadcasts;
  t public.message_templates;
  v_total int; v_ok int;
begin
  if not (select public.can_send_broadcast()) then raise exception 'רק הנהלה יכולה לאשר שליחה' using errcode = '42501'; end if;
  select * into b from public.broadcasts where id = p_id for update;
  if not found or b.status <> 'draft' then raise exception 'ההודעה כבר נשלחה או בוטלה' using errcode = 'P0001'; end if;
  select * into t from public.message_templates where id = b.template_id and active;
  if not found then raise exception 'התבנית לא פעילה' using errcode = 'P0001'; end if;

  -- Runs as the function owner: the full audience matching the filters (only admins/managers get here).
  select count(*), count(*) filter (where a.consented) into v_total, v_ok from public.broadcast_audience(b.filters) a;
  if v_ok = 0 then raise exception 'אין נמענים שהסכימו לקבל הודעות' using errcode = 'P0001'; end if;

  insert into public.broadcast_recipients (broadcast_id, contact_id, phone, vars)
  select b.id, a.contact_id, a.phone,
         array(select case v.name
                        when 'first_name' then coalesce(a.first_name, '')
                        when 'full_name' then coalesce(a.full_name, '')
                        when 'cohort' then coalesce(a.cohort, '')
                        when 'city' then coalesce(a.city, '')
                        else coalesce(b.custom_values[v.i::int], '') end
                 from unnest(t.variables) with ordinality v(name, i) order by v.i)
    from public.broadcast_audience(b.filters) a where a.consented
  on conflict (broadcast_id, contact_id) do nothing;

  update public.broadcasts set status = 'queued', approved_by = auth.uid(), queued_at = now(),
         audience_count = v_ok, skipped_no_consent = v_total - v_ok
   where id = b.id;
  return jsonb_build_object('queued', v_ok, 'skipped_no_consent', v_total - v_ok);
end $$;
revoke execute on function public.queue_broadcast(uuid) from public, anon;
grant execute on function public.queue_broadcast(uuid) to authenticated;

create or replace function public.cancel_broadcast(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.can_send_broadcast()) then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  update public.broadcasts set status = 'cancelled', finished_at = now() where id = p_id and status in ('draft', 'queued', 'sending');
  update public.broadcast_recipients set status = 'skipped', error = 'cancelled', updated_at = now()
   where broadcast_id = p_id and status = 'queued';
end $$;
revoke execute on function public.cancel_broadcast(uuid) from public, anon;
grant execute on function public.cancel_broadcast(uuid) to authenticated;

-- Worker (server, with the ingest secret): take the next batch to send.
create or replace function public.claim_broadcast_batch(p_secret text, p_limit int default 40)
returns table (recipient_id bigint, phone text, vars text[], channel text, provider_template text, language text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.check_ingest_secret(p_secret);
  -- re-check consent at send time: someone may have opted out after the list was frozen
  update public.broadcast_recipients r set status = 'skipped', error = 'opted_out', updated_at = now()
    from public.contacts c
   where r.status = 'queued' and c.id = r.contact_id and c.campaign_consent is distinct from true;
  update public.broadcasts set status = 'sending' where status = 'queued' and (scheduled_at is null or scheduled_at <= now());
  return query
  with picked as (
    select r.id from public.broadcast_recipients r
      join public.broadcasts b on b.id = r.broadcast_id
     where r.status = 'queued' and b.status = 'sending'
     order by b.queued_at, r.id
     limit greatest(1, least(p_limit, 200))
     for update of r skip locked
  )
  update public.broadcast_recipients r set status = 'sending', updated_at = now()
    from picked, public.broadcasts b, public.message_templates t
   where r.id = picked.id and b.id = r.broadcast_id and t.id = b.template_id
  returning r.id, r.phone, r.vars, t.channel, t.provider_template, t.language, t.body;
end $$;
revoke execute on function public.claim_broadcast_batch(text, int) from public;
grant execute on function public.claim_broadcast_batch(text, int) to anon, authenticated;

-- Worker reports results: [{id, ok, message_id, error, retry}] — retry puts the recipient back in the queue
create or replace function public.report_broadcast_results(p_secret text, p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.check_ingest_secret(p_secret);
  update public.broadcast_recipients r set
    status = case when (x ->> 'ok')::boolean then 'sent' when coalesce((x ->> 'retry')::boolean, false) then 'queued' else 'failed' end,
    provider_message_id = nullif(x ->> 'message_id', ''),
    error = nullif(left(x ->> 'error', 300), ''),
    sent_at = case when (x ->> 'ok')::boolean then now() end,
    updated_at = now()
  from jsonb_array_elements(p_results) x
  where r.id = (x ->> 'id')::bigint and r.status = 'sending';
  -- a failed send to a number marks it as suspicious only after delivery failure, not here
  update public.broadcasts b set status = 'sent', finished_at = now()
   where b.status = 'sending' and not exists (
     select 1 from public.broadcast_recipients r where r.broadcast_id = b.id and r.status in ('queued', 'sending'));
end $$;
revoke execute on function public.report_broadcast_results(text, jsonb) from public;
grant execute on function public.report_broadcast_results(text, jsonb) to anon, authenticated;

-- Provider callbacks: delivery status, and inbound replies (opt-out words remove consent).
create or replace function public.ingest_message_event(p_secret text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := p_event ->> 'kind';            -- 'status' | 'inbound'
  v_phone text := public.normalize_il_phone(p_event ->> 'phone');
  v_text text := btrim(coalesce(p_event ->> 'text', ''));
  v_contact uuid;
  v_optout boolean;
begin
  perform public.check_ingest_secret(p_secret);
  if v_kind = 'status' then
    update public.broadcast_recipients set
      status = case p_event ->> 'status' when 'delivered' then 'delivered' when 'read' then 'read' when 'failed' then 'failed' else status end,
      error = coalesce(nullif(left(p_event ->> 'error', 300), ''), error),
      updated_at = now()
     where provider_message_id = p_event ->> 'message_id'
       and not (status = 'read' and p_event ->> 'status' = 'delivered');
    return jsonb_build_object('status', 'processed');
  end if;
  if v_kind <> 'inbound' or v_phone is null then return jsonb_build_object('status', 'ignored'); end if;

  v_contact := public.match_contact_by_phone(v_phone);
  v_optout := lower(regexp_replace(v_text, '[^א-תa-zA-Z]', '', 'g')) in ('הסר', 'הסרה', 'הסירו', 'הסירואותי', 'הסרמהרשימה', 'stop', 'unsubscribe', 'עצור', 'הפסק', 'די');
  insert into public.integration_events (provider, kind, external_id, contact_id, summary, payload)
  values ('whatsapp', 'inbound', coalesce(p_event ->> 'message_id', gen_random_uuid()::text), v_contact,
          case when v_optout then 'בקשת הסרה' else left(v_text, 200) end, p_event -> 'raw')
  on conflict do nothing;
  if v_contact is null then return jsonb_build_object('status', 'unknown_sender', 'opt_out', v_optout); end if;
  if v_optout then
    update public.contacts set campaign_consent = false, campaign_consent_at = now() where id = v_contact;
  end if;
  insert into public.interactions (contact_id, staff_id, kind, context, summary)
  values (v_contact, null, 'message', 'community',
          case when v_optout then 'ביקש/ה להסיר מרשימת התפוצה (הודעה בוואטסאפ/SMS)' else 'הודעה נכנסת: ' || left(v_text, 1900) end);
  return jsonb_build_object('status', 'processed', 'opt_out', v_optout);
end $$;
revoke execute on function public.ingest_message_event(text, jsonb) from public;
grant execute on function public.ingest_message_event(text, jsonb) to anon, authenticated;

insert into public.settings (key, value) values
  ('broadcast_footer', '"להסרה מרשימת התפוצה השיבו: הסר"')
on conflict (key) do nothing;

-- Connection check for the admin screen: true when the server's secret matches the stored hash.
create or replace function public.ingest_ping(p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.check_ingest_secret(p_secret);
  return true;
exception when others then
  return false;
end $$;
revoke execute on function public.ingest_ping(text) from public;
grant execute on function public.ingest_ping(text) to anon, authenticated;

-- Audience size while composing (invoker: the caller's own visibility)
create or replace function public.broadcast_audience_count(p_filters jsonb)
returns table (total int, consented int)
language sql stable set search_path = '' as $$
  select count(*)::int, (count(*) filter (where a.consented))::int from public.broadcast_audience(p_filters) a;
$$;
revoke execute on function public.broadcast_audience_count(jsonb) from public, anon;
grant execute on function public.broadcast_audience_count(jsonb) to authenticated;


-- ===== supabase/migrations/0010_demo_containment.sql =====
-- 0010: security hardening (SECURITY_REPORT.md)
--   C1  shared public-demo accounts cannot touch staff, invites, settings, secrets, templates or broadcasts,
--       even when calling the API directly with their own token
--   L3  helper functions are not callable by anonymous users
--   L4  raw integration payloads (personal data) are not kept for more than 12 months

-- ---------------------------------------------------------------- C1: demo accounts
alter table public.staff add column is_demo boolean not null default false;
update public.staff set is_demo = true where email ~* '^demo-[a-z-]+@example\.org$';

-- derived from the e-mail on every write, so it can never be switched off through the API
create or replace function public.mark_demo_staff()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.is_demo := new.email ~* '^demo-[a-z-]+@example\.org$';
  return new;
end $$;
create trigger staff_mark_demo before insert or update on public.staff
  for each row execute function public.mark_demo_staff();

create or replace function public.is_demo_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.is_demo from public.staff s where s.id = auth.uid()), false);
$$;
revoke execute on function public.is_demo_staff() from public, anon;
grant execute on function public.is_demo_staff() to authenticated;

-- RESTRICTIVE policies are AND-ed with the existing ones: demo accounts keep their read access
-- (so the demo still works) but lose these writes.
create policy "staff: no demo writes" on public.staff as restrictive for update to authenticated
  using (not (select public.is_demo_staff()));
create policy "staff_invites: no demo" on public.staff_invites as restrictive for all to authenticated
  using (not (select public.is_demo_staff())) with check (not (select public.is_demo_staff()));
create policy "settings: no demo writes" on public.settings as restrictive for insert to authenticated
  with check (not (select public.is_demo_staff()));
create policy "settings: no demo updates" on public.settings as restrictive for update to authenticated
  using (not (select public.is_demo_staff()));
create policy "settings: no demo deletes" on public.settings as restrictive for delete to authenticated
  using (not (select public.is_demo_staff()));
create policy "templates: no demo writes" on public.message_templates as restrictive for insert to authenticated
  with check (not (select public.is_demo_staff()));
create policy "templates: no demo updates" on public.message_templates as restrictive for update to authenticated
  using (not (select public.is_demo_staff()));
create policy "templates: no demo deletes" on public.message_templates as restrictive for delete to authenticated
  using (not (select public.is_demo_staff()));
create policy "inquiry_topics: no demo writes" on public.inquiry_topics as restrictive for insert to authenticated
  with check (not (select public.is_demo_staff()));
create policy "inquiry_topics: no demo updates" on public.inquiry_topics as restrictive for update to authenticated
  using (not (select public.is_demo_staff()));
create policy "inquiry_topics: no demo deletes" on public.inquiry_topics as restrictive for delete to authenticated
  using (not (select public.is_demo_staff()));

-- security-definer functions bypass RLS, so they check explicitly
create or replace function public.set_ingest_secret(p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not ((select public.my_role()) = 'admin' and (select public.is_staff_ok())) or public.is_demo_staff() then
    raise exception 'רק מנהל/ת מערכת' using errcode = '42501';
  end if;
  if length(coalesce(p_secret, '')) < 32 then raise exception 'secret too short'; end if;
  insert into public.integration_secrets (name, secret_hash)
  values ('ingest', encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
  on conflict (name) do update set secret_hash = excluded.secret_hash, updated_at = now();
end $$;

create or replace function public.can_send_broadcast()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff_ok() and public.my_role() in ('admin', 'manager') and not public.is_demo_staff();
$$;

-- ---------------------------------------------------------------- L3
revoke execute on function public.can_broadcast(), public.can_send_broadcast() from public, anon;
grant execute on function public.can_broadcast(), public.can_send_broadcast() to authenticated;

-- ---------------------------------------------------------------- L4: payload retention
create or replace function public.trim_integration_payloads()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.integration_events set payload = null
   where payload is not null and received_at < now() - interval '12 months';
  return null;
end $$;
revoke execute on function public.trim_integration_payloads() from public, anon, authenticated;
create trigger integration_events_trim after insert on public.integration_events
  for each statement execute function public.trim_integration_payloads();
create index integration_events_payload_age_idx on public.integration_events (received_at) where payload is not null;


-- ===== supabase/migrations/0011_join_form.sql =====
-- 0011: the public "join the community" questionnaire (sayeret-join-2026) feeds the CRM.
-- A submission finds or creates the person (filling gaps only — never overwriting staff data), sets
-- region / cohort / types / consent from the answers, keeps the full answers for staff, and opens a
-- follow-up case when the person asked to be contacted about something personal.

create table public.join_submissions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts (id) on delete cascade,
  created_contact boolean not null default false,
  form text not null,
  ref text,
  answers jsonb not null,            -- everything except the photo, as sent
  photo bytea,                       -- optional selfie (validated JPEG, ≤ 300 KB)
  dedupe_key text not null unique,   -- phone/email + client timestamp: a double click is stored once
  received_at timestamptz not null default now()
);
create index join_submissions_contact_idx on public.join_submissions (contact_id, received_at desc);
alter table public.join_submissions enable row level security;
-- personal answers (wounded, bereaved, personal matters) are care data
create policy "join_submissions: care read" on public.join_submissions for select to authenticated
  using ((select public.can_see_care()) and public.can_view_contact(contact_id));
create policy "join_submissions: admin delete" on public.join_submissions for delete to authenticated
  using ((select public.my_role()) = 'admin' and (select public.is_staff_ok()));
revoke insert, update on public.join_submissions from authenticated;
revoke all on public.join_submissions from anon;

create or replace function public.submit_join(p jsonb, p_photo bytea default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t text;
  v_first text := left(btrim(coalesce(p ->> 'first_name', '')), 60);
  v_last text := left(btrim(coalesce(p ->> 'last_name', '')), 60);
  v_phone text := public.normalize_il_phone(p ->> 'phone');
  v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  v_conn text := left(coalesce(p ->> 'connection', ''), 60);
  v_year int := case when (p ->> 'enlist_year') ~ '^\d{4}$' then (p ->> 'enlist_year')::int end;
  v_month text := left(coalesce(p ->> 'enlist_month', ''), 20);
  v_region int;
  v_cohort int;
  v_contact uuid;
  v_created boolean;
  v_spam boolean;
  v_personal text[];
  v_answers jsonb;
  v_id uuid;
  v_key text;
begin
  if length(v_first) < 2 then raise exception 'נא לכתוב שם פרטי' using errcode = 'P0001'; end if;
  if v_phone is null then raise exception 'מספר הטלפון לא תקין' using errcode = 'P0001'; end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then v_email := null; end if;
  if pg_column_size(p) > 20000 then raise exception 'הטופס ארוך מדי' using errcode = 'P0001'; end if;

  -- only short strings and short arrays of short strings are kept
  select jsonb_object_agg(k, case
           when jsonb_typeof(v) = 'string' then to_jsonb(left(v #>> '{}', 1000))
           when jsonb_typeof(v) = 'array' then (select coalesce(jsonb_agg(left(e, 120)), '[]') from (select jsonb_array_elements_text(v) e limit 20) a)
           when jsonb_typeof(v) in ('boolean', 'number', 'null') then v
           else 'null'::jsonb end)
    into v_answers
    from jsonb_each(p - 'selfie_jpeg') as x(k, v)
   where k ~ '^[a-z_]{1,40}$';

  v_key := coalesce(v_phone, v_email) || ':' || left(coalesce(p ->> 'submitted_at', ''), 40);
  if exists (select 1 from public.join_submissions where dedupe_key = v_key) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  -- circuit breaker against floods with made-up phone numbers (the form is public)
  if (select count(*) from public.join_submissions where received_at > now() - interval '1 hour') >= 300 then
    raise exception 'יש עומס כרגע. נסו שוב בעוד שעה.' using errcode = 'P0001';
  end if;
  v_spam := public.public_rate_check(v_phone, 'join_form');

  select f.contact_id, f.created into v_contact, v_created
    from public.ingest_find_or_create_contact(null, v_first, v_last, v_phone, v_email, 'join_form') f;

  -- region (only when empty)
  v_region := (select r.id from public.regions r where r.label = case p ->> 'region'
      when 'גליל עליון + רמת הגולן' then 'צפון' when 'צפון' then 'צפון' when 'גליל תחתון + עמקים' then 'עמקים'
      when 'מנשה + שרון' then 'שרון' when 'גוש דן + השפלה' then 'מרכז' when 'ירושלים' then 'ירושלים'
      when 'שומרון' then 'יהודה ושומרון' when 'לכיש + נגב' then 'דרום' when 'מחוץ לישראל' then 'חו"ל' end);
  -- cohort: an existing "month year" cohort (only when empty)
  if v_year is not null and v_month <> '' then
    v_cohort := (select c.id from public.cohorts c where c.label = v_month || ' ' || v_year);
  end if;
  update public.contacts c set
    region_id = coalesce(c.region_id, v_region),
    cohort_id = coalesce(c.cohort_id, v_cohort),
    profession = coalesce(c.profession, nullif(left(btrim(concat_ws(' · ', nullif(p ->> 'work_role', ''), nullif(p ->> 'work_field', ''))), 120), '')),
    campaign_consent = case when (p ->> 'consent')::boolean is true and c.campaign_consent is distinct from false then true else c.campaign_consent end,
    campaign_consent_at = case when (p ->> 'consent')::boolean is true and c.campaign_consent is distinct from false then now() else c.campaign_consent_at end,
    available_to_help = c.available_to_help or exists (
      select 1 from jsonb_array_elements_text(coalesce(p -> 'give', '[]')) g where g <> 'כרגע לא, אולי בהמשך')
  where c.id = v_contact;

  -- who they are to the unit
  if v_conn in ('פלס״ר / פלגה א׳', 'פלחה״ן / פלגה ב׳', 'פלנ״ט-עורב / פלגה ג׳', 'מסייעת', 'מפג״ד / פלס״ם') then
    perform public.add_contact_type(v_contact, 'alumni');
  elsif v_conn = 'משפחה שכולה' then
    perform public.add_contact_type(v_contact, 'bereaved');
  elsif v_conn = 'מתנדב/ת' then
    perform public.add_contact_type(v_contact, 'volunteer');
  end if;
  select coalesce(array_agg(e), '{}') into v_personal from jsonb_array_elements_text(coalesce(p -> 'personal', '[]')) e;
  if v_personal && array['פצוע/ה, מוכר/ת במשרד הביטחון', 'פצוע/ה, לא מוכר/ת'] then
    perform public.add_contact_type(v_contact, 'wounded');
  end if;
  if 'בן/בת למשפחה שכולה' = any (v_personal) then perform public.add_contact_type(v_contact, 'bereaved'); end if;
  -- the answer itself is not stored as a label on the person (sensitive); staff see it in the submission
  if 'מתמודד/ת נפשית' = any (v_personal) then perform public.add_contact_type(v_contact, 'support'); end if;
  if 'כרגע לא, אולי בהמשך' <> all (select jsonb_array_elements_text(coalesce(p -> 'give', '[]'))) and jsonb_array_length(coalesce(p -> 'give', '[]')) > 0 then
    perform public.add_contact_type(v_contact, 'volunteer');
  end if;

  insert into public.join_submissions (contact_id, created_contact, form, ref, answers, photo, dedupe_key)
  values (v_contact, v_created, left(coalesce(p ->> 'form', ''), 40), nullif(left(coalesce(p ->> 'ref', ''), 40), ''),
          v_answers, case when p_photo is not null and length(p_photo) <= 307200 and substr(p_photo, 1, 3) = '\xffd8ff'::bytea then p_photo end,
          v_key)
  returning id into v_id;

  -- a personal matter or a request to be called back becomes a case for the welfare team
  if cardinality(v_personal) > 0 or nullif(btrim(coalesce(p ->> 'personal_contact', '')), '') is not null then
    insert into public.cases (kind, category, source, priority, contact_id, requester_name, requester_phone, requester_email,
                              preferred_channel, message, assignee_id, created_by, suspected_spam)
    values ('request', 'welfare', 'join_form', 'high', v_contact, btrim(v_first || ' ' || v_last), v_phone, v_email, 'phone',
            'נרשם/ה בטופס ההצטרפות וסימן/ה נושא אישי שכדאי לחזור אליו. הפרטים בכרטיס, בתשובות לטופס.'
              || coalesce(' · איך ליצור קשר: ' || nullif(left(btrim(p ->> 'personal_contact'), 300), ''), ''),
            (select s.id from public.staff s join public.inquiry_topics t on t.assignee_id = s.id where t.code = 'welfare' and s.is_active),
            null, v_spam);
  end if;

  return jsonb_build_object('status', 'processed', 'created', v_created);
end $$;
revoke execute on function public.submit_join(jsonb, bytea) from public;
grant execute on function public.submit_join(jsonb, bytea) to anon, authenticated;


-- ===== supabase/seed/demo.sql =====
-- =============================================================
-- DEMO DATA — fictional people, all rows marked is_demo = true.
-- Phones are in the 050-000-XXXX range and e-mails use example.org.
-- Run once, AFTER the first staff accounts exist (owners are drawn from them).
-- Remove before loading real data: Admin → נתוני דוגמה → מחיקה.
-- =============================================================
select setseed(0.42);

insert into public.cohorts (label, sort_key)
select m.label || ' ' || y, y * 10 + m.ord
from generate_series(2004, 2024) y,
     (values ('מרץ', 1), ('אוגוסט', 2), ('נובמבר', 3)) as m(label, ord)
on conflict (label) do nothing;

insert into public.campaigns (name, goal_amount, starts_on, ends_on, description) values
  ('קמפיין ראש השנה 2026', 150000, '2026-08-15', '2026-09-30', 'דוגמה'),
  ('קרן סיוע ללוחמים', 400000, '2026-01-01', '2026-12-31', 'דוגמה')
on conflict (name) do nothing;

with names as (
  select
    array['איתי','יונתן','עומר','נועם','איתמר','אורי','יואב','דניאל','אביב','רועי','עידו','תומר','אלון','גיל','אסף','נדב','אריאל','עמית','יובל','שחר','בן','אלעד','מתן','ליאור','אופיר','הראל','ניר','אוהד','רז','טל','גלעד','אמיר','שי','עידן','אליה','נתנאל','יהונתן','אביתר','עוז','דור'] as m,
    array['נועה','מיכל','שירה','תמר','יעל','הדר','רוני','מאיה','ליאת','דנה','עדי','אורית','רחל','שרית','אסנת'] as f,
    array['כהן','לוי','מזרחי','פרץ','ביטון','דהן','אברהם','פרידמן','אזולאי','מלכה','חדד','גבאי','שפירא','אוחיון','יוסף','דוד','בן דוד','קפלן','רוזן','גולדברג','שלום','ברק','גרינברג','אלון','סגל','טל','נחום','זילברמן','בר','הלוי','ששון','עמר','וקנין','אדרי','לנדאו','רבינוביץ','שגיא','קדוש','חזן','ברגר'] as l,
    array['קריית שמונה','חיפה','עפולה','כפר סבא','רעננה','פתח תקווה','תל אביב','ירושלים','מודיעין','רחובות','באר שבע','אריאל','קצרין','נתניה','הרצליה','ראשון לציון','אשדוד','גבעתיים','יוקנעם','זכרון יעקב'] as cities,
    array['עורך/ת דין','מהנדס/ת תוכנה','מורה','רופא/ה','מנהל/ת פרויקטים','חשמלאי/ת','רואה/ת חשבון','עובד/ת סוציאלי/ת','יזם/ית','חקלאי/ת','מתכנת/ת','אדריכל/ית','שוטר/ת','סטודנט/ית','נהג/ת','מנהל/ת מכירות'] as profs,
    array['משפטים','הנדסה','חינוך','רפואה','טכנולוגיה','ניהול','עסקים','שיפוצים','חשבונאות','ייעוץ תעסוקתי','גישור','צילום','שיווק','נגרות','אימון אישי'] as skills
), staffpool as (
  select coalesce(array_agg(id), '{}') as ids from public.staff where is_active
)
insert into public.contacts (first_name, last_name, phone, phone_status, email, cohort_id, region_id, city, owner_id,
                             profession, skills, available_to_help, skills_share_consent, verified_at, verified_by,
                             campaign_consent, source, is_demo)
select
  case when random() < 0.08 then n.f[1 + floor(random() * array_length(n.f, 1))::int] else n.m[1 + floor(random() * array_length(n.m, 1))::int] end,
  n.l[1 + floor(random() * array_length(n.l, 1))::int],
  case when random() < 0.9 then '+97250000' || lpad(g::text, 4, '0') end,
  case when random() < 0.04 then 'invalid'::public.phone_status else 'unknown'::public.phone_status end,
  case when random() < 0.55 then 'demo' || g || '@example.org' end,
  case when random() < 0.93 then (select id from public.cohorts where g > 0 order by random() limit 1) end,
  case when random() < 0.85 then (select id from public.regions where g > 0 order by random() limit 1) end,
  case when random() < 0.7 then n.cities[1 + floor(random() * array_length(n.cities, 1))::int] end,
  case when random() < 0.82 and cardinality(sp.ids) > 0 then sp.ids[1 + floor(random() * cardinality(sp.ids))::int] end,
  case when random() < 0.35 then n.profs[1 + floor(random() * array_length(n.profs, 1))::int] end,
  case when random() < 0.2 then array[n.skills[1 + floor(random() * array_length(n.skills, 1))::int], n.skills[1 + floor(random() * array_length(n.skills, 1))::int]] else '{}' end,
  random() < 0.12,
  random() < 0.08,
  case when random() < 0.45 then now() - (random() * 900 || ' days')::interval end,
  'staff',
  case when random() < 0.3 then true when random() < 0.2 then false end,
  'demo',
  true
from generate_series(1, 3000) g, names n, staffpool sp;

-- de-duplicate the skills arrays created above
update public.contacts set skills = array(select distinct unnest(skills)) where is_demo and cardinality(skills) > 1;

-- contact types
insert into public.contact_type_links (contact_id, type_code)
select id, 'alumni' from public.contacts where is_demo;
insert into public.contact_type_links (contact_id, type_code)
select id, t.code from public.contacts c,
  (values ('reservist', 0.40), ('wounded', 0.04), ('support', 0.03), ('donor', 0.08), ('volunteer', 0.06)) as t(code, p)
-- per-person draw (a plain random() here would be evaluated once per tag type)
where c.is_demo and (abs(hashtext(c.id::text || t.code)) % 10000) < t.p * 10000
on conflict do nothing;

-- care status distribution (the trigger brings next calls forward for urgent statuses)
update public.contact_care cc set status_code = s.code
from (select id, random() r from public.contacts where is_demo) c,
     lateral (select case
        when c.r < 0.01 then 'distress' when c.r < 0.03 then 'close' when c.r < 0.07 then 'follow_up'
        when c.r < 0.09 then 'rehab' when c.r < 0.80 then 'routine' when c.r < 0.94 then 'good' else 'lost' end as code) s
where cc.contact_id = c.id;
update public.contact_care set status_code = 'rehab'
where contact_id in (select contact_id from public.contact_type_links where type_code = 'wounded')
  and status_code in ('routine', 'good') and (abs(hashtext(contact_id::text)) % 10) < 6;

-- past interactions
with staffpool as (select coalesce(array_agg(id), '{}') ids from public.staff where is_active)
insert into public.interactions (contact_id, staff_id, kind, outcome, context, summary, occurred_at)
select c.id,
       case when cardinality(sp.ids) > 0 then sp.ids[1 + floor(random() * cardinality(sp.ids))::int] end,
       (array['call','call','call','message','meeting','attempt'])[1 + floor(random() * 6)::int]::public.interaction_kind,
       (array['talked','talked','talked','no_answer','needs_followup','rescheduled'])[1 + floor(random() * 6)::int]::public.interaction_outcome,
       'community',
       (array['שיחה טובה, הכול בסדר','עדכן שעבר דירה','מתעניין באירוע המחזור','ביקש שנחזור אליו אחרי החגים','לא ענה, ננסה שוב', null])[1 + floor(random() * 6)::int],
       now() - (random() * 400 || ' days')::interval
from public.contacts c, staffpool sp, generate_series(1, 3) k
where c.is_demo and (abs(hashtext(c.id::text || k)) % 100) < 35;

update public.contact_care cc set last_contact_at = x.last
from (select contact_id, max(occurred_at) last from public.interactions
      where outcome in ('talked', 'needs_followup') or kind = 'meeting' group by contact_id) x
where cc.contact_id = x.contact_id;

-- realistic schedule: next call = last contact (or an earlier date) + cadence, so some calls are already due
update public.contact_care cc
set next_contact_at = greatest(
      coalesce(cc.last_contact_at::date + public.effective_cadence(cc.status_code, cc.cadence_days), current_date + 30),
      -- most people are scheduled ahead; ~5% are a few days late, like a normal working week
      current_date - 7 + (abs(hashtext(cc.contact_id::text)) % (public.effective_cadence(cc.status_code, cc.cadence_days) + 7)))
from public.contacts c where c.id = cc.contact_id and c.is_demo;

-- bereaved families (no fallen records: the real list is imported by the association)
with fam as (
  insert into public.contacts (first_name, last_name, phone, email, region_id, source, is_demo, verified_at, verified_by)
  select (array['רחל','משה','אורית','דוד','שרה','יעקב','מרים','אבי','חנה','יוסי','לאה','שמעון'])[g], 'משפחת דוגמה',
         '+97250001' || lpad(g::text, 3, '0'), null, (select id from public.regions where g > 0 order by random() limit 1),
         'demo', true, now() - interval '100 days', 'staff'
  from generate_series(1, 12) g
  returning id
)
insert into public.contact_type_links (contact_id, type_code) select id, 'bereaved' from fam;

update public.contact_care set status_code = 'close'
where contact_id in (select id from public.contacts where is_demo and last_name = 'משפחת דוגמה');

-- events
insert into public.events (title, starts_at, location, cohort_id, description, is_demo)
values
  ('ערב מחזור נובמבר 2012', now() + interval '9 days', 'מועדון היחידה', (select id from public.cohorts where label = 'נובמבר 2012'), 'דוגמה', true),
  ('מסע אופניים לזכר החללים', now() + interval '24 days', 'גלבוע', null, 'דוגמה', true),
  ('מפגש תעסוקה ליוצאי היחידה', now() + interval '40 days', 'תל אביב', null, 'דוגמה', true);

-- cases (requests and concerns), some overdue / unassigned
with staffpool as (select coalesce(array_agg(id), '{}') ids from public.staff where is_active),
-- number the 24 picked people 1..24 (row_number must be taken after the random pick)
picked as (select id, first_name, row_number() over () rn
           from (select id, first_name from public.contacts where is_demo order by random() limit 24) x)
insert into public.cases (kind, contact_id, category, source, message, priority, assignee_id, opened_at, due_at, status, is_demo)
select
  case when p.rn % 6 = 0 then 'concern'::public.case_kind else 'request'::public.case_kind end,
  p.id,
  (array['talk','assistance','employment','legal','event','other'])[1 + (p.rn % 6)::int],
  (array['talk_form','staff','phone','whatsapp'])[1 + (p.rn % 4)::int],
  (array['ביקש שיחה עם מישהו מהצוות','צריך עזרה במילוי טפסים מול משרד הביטחון','מחפש עבודה בתחום ההייטק','שאלה לגבי זכויות במילואים','רוצה לעזור בארגון אירוע','חבר מהצוות מספר שהוא מסתגר לאחרונה'])[1 + (p.rn % 6)::int],
  case when p.rn % 6 = 0 then 'high'::public.case_priority when p.rn % 5 = 0 then 'urgent'::public.case_priority else 'normal'::public.case_priority end,
  case when p.rn % 4 = 0 or cardinality(sp.ids) = 0 then null else sp.ids[1 + floor(random() * cardinality(sp.ids))::int] end,
  now() - ((p.rn - 1) || ' days')::interval - interval '3 hours',
  now() - ((p.rn - 1) || ' days')::interval - interval '3 hours' + case when p.rn % 6 = 0 then interval '2 days' else interval '7 days' end,
  'new',
  true
from picked p, staffpool sp;

-- donations
insert into public.donations (contact_id, amount, donated_at, method, campaign_id, is_recurring, is_demo)
select c.id,
       (array[100, 180, 250, 360, 500, 1000, 1800, 5000])[1 + floor(random() * 8)::int],
       current_date - floor(random() * 500)::int,
       (array['אשראי','העברה','הוראת קבע'])[1 + floor(random() * 3)::int],
       (select id from public.campaigns where c.id is not null order by random() limit 1),
       random() < 0.2,
       true
from public.contacts c join public.contact_type_links l on l.contact_id = c.id and l.type_code = 'donor', generate_series(1, 2) k
where c.is_demo and (abs(hashtext(c.id::text || k)) % 10) < 7;

-- "הרשימה הורודה": ~7% used the association's discounts or community services
-- (some of them also donate, and are therefore active payers who drop off the list)
insert into public.contact_type_links (contact_id, type_code)
select id, 'pink' from public.contacts
where is_demo and last_name <> 'משפחת דוגמה' and abs(hashtext(id::text || ':pink')) % 100 < 7
on conflict do nothing;


-- ===== supabase/seed/test-staff-invites.sql =====
-- DEV/TEST ONLY: invites for one test account per role (addresses on the reserved example.org domain).
-- The accounts are created by signing up in the app ("קיבלתי הזמנה").
insert into public.staff_invites (email, full_name, role, cohort_scope) values
  ('qa-admin@example.org',  'בודק/ת מנהל/ת מערכת', 'admin', '{}'),
  ('qa-coord@example.org',  'בודק/ת רכז/ת קהילה',  'coordinator', '{}'),
  ('qa-lead@example.org',   'בודק/ת אחראי/ת מחזור', 'cohort_lead', array(select id from public.cohorts where label = 'נובמבר 2012')),
  ('qa-donors@example.org', 'בודק/ת רכז/ת תורמים', 'donor_coordinator', '{}'),
  ('qa-vol@example.org',    'בודק/ת מתנדב/ת',      'volunteer', '{}')
on conflict (email) do nothing;


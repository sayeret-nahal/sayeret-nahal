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

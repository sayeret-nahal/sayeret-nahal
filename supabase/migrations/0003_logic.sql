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

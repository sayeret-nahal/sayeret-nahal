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

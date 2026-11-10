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

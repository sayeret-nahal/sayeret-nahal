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

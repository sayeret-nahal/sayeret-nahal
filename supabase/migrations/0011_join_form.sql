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

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

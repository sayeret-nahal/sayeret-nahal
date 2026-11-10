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

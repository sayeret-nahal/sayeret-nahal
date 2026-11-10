-- PUBLIC DEMO ONLY: five demo staff accounts (one per role) created directly in Supabase Auth,
-- with one shared password that is substituted for __DEMO_PASSWORD__ when the bundle is generated.
-- Run after the migrations and supabase/seed/demo.sql. Never on a project with real data.
insert into public.staff_invites (email, full_name, role, cohort_scope) values
  ('demo-admin@example.org',             'הדגמה · מנהל/ת מערכת',  'admin', '{}'),
  ('demo-coordinator@example.org',       'הדגמה · רכז/ת קהילה',   'coordinator', '{}'),
  ('demo-cohort-lead@example.org',       'הדגמה · אחראי/ת מחזור', 'cohort_lead', array(select id from public.cohorts where label = 'נובמבר 2012')),
  ('demo-donor-coordinator@example.org', 'הדגמה · רכז/ת תורמים',  'donor_coordinator', '{}'),
  ('demo-volunteer@example.org',         'הדגמה · מתנדב/ת',       'volunteer', '{}')
on conflict (email) do nothing;

with u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', i.email,
         extensions.crypt('__DEMO_PASSWORD__', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from public.staff_invites i where i.email like 'demo-%@example.org'
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from u;

-- give the demo people owners so every role has real work on its home screen
with s as (select array_agg(id order by email) ids from public.staff where role in ('coordinator', 'cohort_lead', 'volunteer', 'admin'))
update public.contacts set owner_id = s.ids[1 + (abs(hashtext(contacts.id::text)) % cardinality(s.ids))]
from s where is_demo and owner_id is null and (abs(hashtext(contacts.id::text || 'o')) % 100) < 85;
with s as (select array_agg(id) ids from public.staff where role in ('coordinator', 'admin'))
update public.cases set assignee_id = s.ids[1 + (abs(hashtext(cases.id::text)) % cardinality(s.ids))]
from s where is_demo and assignee_id is null and (abs(hashtext(cases.id::text || 'a')) % 100) < 60;
update public.contacts set owner_id = (select id from public.staff where role = 'donor_coordinator')
where id in (select contact_id from public.contact_type_links where type_code = 'donor')
  and (abs(hashtext(id::text || 'd')) % 2) = 0;

-- demo convenience: no authenticator app needed (a real deployment keeps this true)
update public.settings set value = 'false' where key = 'require_mfa';

-- DEV/TEST ONLY: invites for one test account per role (addresses on the reserved example.org domain).
-- The accounts are created by signing up in the app ("קיבלתי הזמנה").
insert into public.staff_invites (email, full_name, role, cohort_scope) values
  ('qa-admin@example.org',  'בודק/ת מנהל/ת מערכת', 'admin', '{}'),
  ('qa-coord@example.org',  'בודק/ת רכז/ת קהילה',  'coordinator', '{}'),
  ('qa-lead@example.org',   'בודק/ת אחראי/ת מחזור', 'cohort_lead', array(select id from public.cohorts where label = 'נובמבר 2012')),
  ('qa-donors@example.org', 'בודק/ת רכז/ת תורמים', 'donor_coordinator', '{}'),
  ('qa-vol@example.org',    'בודק/ת מתנדב/ת',      'volunteer', '{}')
on conflict (email) do nothing;

-- =============================================================
-- Nahal CRM — reference data (editable later by an admin)
-- Labels and cadences are working assumptions to be confirmed
-- with the association (see docs/02-product-spec.md).
-- =============================================================

insert into public.contact_types (code, label, is_sensitive, sort_key) values
  ('reservist',   'לוחם/ת מילואים',   false, 10),
  ('alumni',      'יוצא/ת הסיירת',    false, 20),
  ('wounded',     'פצוע/ה',           true,  30),
  ('support',     'בליווי מיוחד',     true,  40), -- neutral label, no diagnosis (replaces "PTSD")
  ('bereaved',    'משפחה שכולה',      true,  50),
  ('donor',       'תורם/ת',           false, 60),
  ('volunteer',   'מתנדב/ת',          false, 70);

insert into public.care_statuses (code, label, cadence_days, severity, sort_key) values
  ('distress',    'במצוקה',        7,   3, 10),
  ('close',       'מעקב צמוד',     14,  2, 20),
  ('follow_up',   'נדרש מעקב',     30,  1, 30),
  ('rehab',       'בשיקום',        30,  1, 40),
  ('routine',     'בשגרה',         90,  0, 50),
  ('good',        'בקשר תקין',     180, 0, 60),
  ('lost',        'נותק הקשר',     90,  1, 70);

insert into public.regions (label, sort_key) values
  ('צפון', 10), ('חיפה והקריות', 20), ('עמקים', 30), ('שרון', 40), ('מרכז', 50),
  ('תל אביב', 60), ('ירושלים', 70), ('שפלה', 80), ('דרום', 90), ('יהודה ושומרון', 100), ('חו"ל', 110);

insert into public.settings (key, value) values
  ('org_name', '"עמותת סיירת נחל"'),
  ('require_mfa', 'true'),               -- production must keep this true
  ('idle_timeout_minutes', '30'),
  ('stale_after_days', '365'),
  ('request_sla_days', '7'),
  ('talk_response_hours', '24'),
  ('concern_response_hours', '48'),
  ('talk_response_text', '"נחזור אליך תוך 24 שעות, בדרך כלל מוקדם יותר. בשבתות ובחגים ייתכן עיכוב."'),
  ('emergency_text', '"אם יש סכנה מיידית לחיים — חייגו 101 (מד\"א) או 100 (משטרה). לתמיכה נפשית מיידית, 24/7: ער\"ן 1201."'),
  ('privacy_notice_version', '"draft-2026-11"'),
  ('privacy_notice_text', '"המידע נאסף על ידי עמותת סיירת נחל כדי לשמור איתך על קשר ולסייע לך. מסירת המידע אינה חובה. המידע לא יועבר לגורם אחר ללא הסכמתך, ותוכל/י לעיין בו ולבקש לתקנו בכל עת. (נוסח טיוטה — טעון אישור משפטי)"');

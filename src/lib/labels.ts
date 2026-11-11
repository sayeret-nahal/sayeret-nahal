import type { AppRole, CaseStatus, InteractionKind, InteractionOutcome, Priority } from "./types";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "מנהל/ת מערכת",
  manager: "מנהל/ת עמותה",
  coordinator: "רכז/ת קשרי קהילה",
  cohort_lead: "אחראי/ת מחזור או אזור",
  donor_coordinator: "רכז/ת תורמים",
  volunteer: "מתנדב/ת מורשה",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "רואה הכול, מנהל משתמשים, הרשאות והגדרות, קורא את יומן הפעולות.",
  manager: "רואה הכול, מאחד כפילויות, מייצא נתונים ומפיק דוחות.",
  coordinator: "רואה את כל הקהילה, הפניות והמעקב. לא רואה תרומות.",
  cohort_lead: "רואה רק את המחזורים או האזורים שהוקצו לו, ואת מי שהוא אחראי עליו.",
  donor_coordinator: "רואה תורמים ותרומות בלבד. לא רואה מידע רווחה, פניות או תגיות רגישות.",
  volunteer: "רואה רק את האנשים שהוקצו לו ומתעד שיחות. לא עורך פרטים.",
};

export const KIND_LABELS: Record<InteractionKind, string> = {
  call: "שיחת טלפון",
  meeting: "פגישה",
  message: "הודעה",
  attempt: "ניסיון ליצור קשר",
  event: "השתתפות באירוע",
  note: "הערה",
};

export const OUTCOME_LABELS: Record<InteractionOutcome, string> = {
  talked: "התקיימה שיחה",
  no_answer: "לא היה מענה",
  rescheduled: "נקבעה שיחה נוספת",
  needs_followup: "נדרש המשך טיפול",
  no_contact_requested: "ביקש/ה לא ליצור קשר בתקופה הקרובה",
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "חדשה",
  in_progress: "בטיפול",
  waiting: "ממתינה למשהו",
  resolved: "טופלה",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  normal: "רגילה",
  high: "גבוהה",
  urgent: "דחופה",
};

export const CASE_KIND_LABELS = { request: "פנייה", concern: "דיווח חשש" } as const;

export const CASE_SOURCE_LABELS: Record<string, string> = {
  talk_form: "טופס \"אני צריך/ה לדבר\"",
  concern_form: "טופס \"מודאג לגבי חבר\"",
  staff: "נפתחה על ידי הצוות",
  website: "טופס פנייה באתר",
  join_form: "טופס הצטרפות",
  phone: "טלפון",
  whatsapp: "וואטסאפ",
  email: "דוא\"ל",
  other: "אחר",
};

export const CHANNEL_LABELS: Record<string, string> = {
  phone: "שיחת טלפון",
  whatsapp: "וואטסאפ",
  sms: "הודעת SMS",
};

export const CATEGORY_LABELS: Record<string, string> = {
  talk: "רוצה לדבר",
  concern: "חשש לגבי חבר",
  assistance: "בקשת סיוע",
  employment: "תעסוקה",
  legal: "זכויות ומשפט",
  event: "אירוע / פעילות",
  other: "אחר",
  // website inquiry topics (inquiry_topics)
  welfare: "רווחה וסיוע",
  wounded: "פצועים ונפגעים",
  social: "רכז/ת חברתי/ת",
  bereaved: "משפחות שכולות",
  membership: "חברות בעמותה",
  donations: "תרומות ושותפויות",
  volunteering: "התנדבות",
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: "הוזן ידנית",
  import: "ייבוא מקובץ",
  self_update: "עדכון עצמי",
  talk_form: "טופס פנייה",
  concern_form: "טופס חשש",
  website: "טופס באתר",
  join_form: "טופס הצטרפות",
  jgive: "תשלום ב-JGive",
  grow: "תשלום ב-Grow",
  nexus: "מועדון נקסוס",
  demo: "נתוני דוגמה",
};

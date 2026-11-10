// Definitions of the impact-report metrics. Each definition states exactly what
// public.impact_report() (supabase/migrations/0003_logic.sql) counts, so every
// number in the report can be checked. Keep in sync with the SQL.

export type ImpactKey =
  | "community_size" | "people_reached" | "calls_made" | "calls_talked" | "meetings"
  | "cases_opened" | "cases_resolved" | "cases_resolved_on_time" | "talk_requests"
  | "volunteers" | "helpers_available" | "events_held"
  | "donations_count" | "donations_sum" | "donors_unique";

export type ImpactReport = Record<ImpactKey, number> & { includes_demo: boolean };

export type MetricGroup = "contact" | "cases" | "community" | "donations";

export interface MetricDef {
  key: ImpactKey;
  label: string;
  definition: string;
  group: MetricGroup;
  /** "period" = counted inside the chosen dates; "now" = state of the records today. */
  scope: "period" | "now";
  currency?: boolean;
}

export const GROUP_LABELS: Record<MetricGroup, { title: string; subtitle: string }> = {
  contact: { title: "קשר אישי עם הקהילה", subtitle: "שיחות, פגישות וקשר שתועדו על ידי הצוות והמתנדבים" },
  cases: { title: "פניות וליווי", subtitle: "בקשות עזרה ודיווחי חשש שהגיעו לעמותה" },
  community: { title: "הקהילה ורשת התמיכה", subtitle: "מי שמחובר לעמותה ומי שמוכן לעזור" },
  donations: { title: "תרומות", subtitle: "לפי תאריך התרומה" },
};

export const IMPACT_METRICS: MetricDef[] = [
  {
    key: "people_reached", group: "contact", scope: "period", label: "אנשים שהיה איתם קשר",
    definition: "אנשים שתועד איתם בתקופה קשר בפועל: כל תיעוד שתוצאתו \"התקיימה שיחה\" או \"נדרש המשך טיפול\", או פגישה, הודעה או השתתפות באירוע שתועדו בלי תוצאה. כל אדם נספר פעם אחת. ניסיונות שלא נענו ושיחות תורמים לא נספרים.",
  },
  {
    key: "calls_made", group: "contact", scope: "period", label: "שיחות וניסיונות התקשרות",
    definition: "כל שיחת טלפון וכל ניסיון ליצור קשר שתועדו בתקופה, כולל כאלה שלא נענו. כל תיעוד נספר בנפרד. לא כולל שיחות תורמים.",
  },
  {
    key: "calls_talked", group: "contact", scope: "period", label: "שיחות שבהן דיברו",
    definition: "שיחות טלפון שתועדו בתקופה עם התוצאה \"התקיימה שיחה\" או \"נדרש המשך טיפול\". כל שיחה נספרת בנפרד, כך שאדם שדיברו איתו פעמיים נספר פעמיים.",
  },
  {
    key: "meetings", group: "contact", scope: "period", label: "פגישות",
    definition: "פגישות שתועדו בתקופה (תיעוד מסוג \"פגישה\"). כל פגישה נספרת בנפרד.",
  },
  {
    key: "cases_opened", group: "cases", scope: "period", label: "פניות שנפתחו",
    definition: "פניות ודיווחי חשש שנפתחו בתקופה, מכל המקורות: טפסים באתר, טלפון, וואטסאפ ופניות שהצוות פתח.",
  },
  {
    key: "cases_resolved", group: "cases", scope: "period", label: "פניות שטופלו ונסגרו",
    definition: "פניות שסומנו כ\"טופלה\" בתקופה, גם אם נפתחו לפניה. אי אפשר לסגור פנייה בלי לתעד מה נעשה.",
  },
  {
    key: "cases_resolved_on_time", group: "cases", scope: "period", label: "נסגרו בזמן",
    definition: "מתוך הפניות שנסגרו בתקופה — אלה שנסגרו עד מועד היעד שנקבע להן בפתיחה, לפי זמני התגובה שבהגדרות המערכת.",
  },
  {
    key: "talk_requests", group: "cases", scope: "period", label: "פניות \"אני צריך/ה לדבר\"",
    definition: "פניות שהגיעו בתקופה דרך הכפתור \"אני צריך/ה לדבר\" באתר העמותה. הן חלק מ\"פניות שנפתחו\".",
  },
  {
    key: "community_size", group: "community", scope: "now", label: "אנשים בקהילה",
    definition: "כל האנשים הרשומים במערכת היום, מכל סוגי הקשר (כולל בני משפחה, תורמים ומתנדבים). לא כולל רשומות בארכיון ורשומות כפולות שאוחדו. לא תלוי בתקופה.",
  },
  {
    key: "volunteers", group: "community", scope: "now", label: "מתנדבים",
    definition: "אנשים שמסומנים היום כ\"מתנדב/ת\", לא כולל רשומות בארכיון. לא תלוי בתקופה.",
  },
  {
    key: "helpers_available", group: "community", scope: "now", label: "זמינים לעזור לחברים",
    definition: "אנשים שאמרו שהם זמינים לעזור לחברים מהקהילה (במאגר הכישורים), לא כולל רשומות בארכיון. לא תלוי בתקופה.",
  },
  {
    key: "events_held", group: "community", scope: "period", label: "אירועים ומפגשים",
    definition: "אירועים מלוח האירועים של העמותה שהתחילו בתקופה.",
  },
  {
    key: "donations_count", group: "donations", scope: "period", label: "תרומות",
    definition: "מספר התרומות שתאריך התרומה שלהן בתקופה, בכל המטבעות. כל תשלום נספר בנפרד, כולל תשלומים של הוראת קבע.",
  },
  {
    key: "donations_sum", group: "donations", scope: "period", label: "סכום התרומות", currency: true,
    definition: "סכום התרומות בשקלים שתאריך התרומה שלהן בתקופה. תרומות במטבע אחר לא נכללות בסכום.",
  },
  {
    key: "donors_unique", group: "donations", scope: "period", label: "תורמים",
    definition: "מספר האנשים השונים שתרמו בתקופה. כל תורם/ת נספר/ת פעם אחת, גם אם תרם/ה כמה פעמים.",
  },
];

export function formatMetric(def: MetricDef, value: number): string {
  if (def.currency) {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
  }
  return value.toLocaleString("he-IL");
}

/** Normalise the RPC result (numbers may arrive as strings for numeric columns). */
export function parseImpact(raw: unknown): ImpactReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = { includes_demo: r.includes_demo === true } as ImpactReport;
  for (const m of IMPACT_METRICS) {
    const n = Number(r[m.key] ?? 0);
    out[m.key] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** Metrics a role may see. Donation figures only for roles that manage donors. */
export function visibleMetrics(canSeeDonations: boolean): MetricDef[] {
  return IMPACT_METRICS.filter((m) => canSeeDonations || m.group !== "donations");
}

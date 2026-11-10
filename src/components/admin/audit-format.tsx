import { ROLE_LABELS } from "@/lib/labels";
import type { AppRole } from "@/lib/types";

export const ACTION_LABELS: Record<string, string> = {
  insert: "יצירה",
  update: "עדכון",
  delete: "מחיקה",
  merge: "איחוד רשומות",
  view: "צפייה",
  export: "ייצוא",
  report: "הפקת דוח",
  search: "חיפוש",
  login: "כניסה",
  logout: "יציאה",
  mfa_verified: "אימות דו-שלבי",
};

export const TABLE_LABELS: Record<string, string> = {
  contacts: "אנשים",
  contact_care: "מעקב ומצב קשר",
  contact_type_links: "תגיות סוג קשר",
  interactions: "תיעוד שיחות וקשר",
  cases: "פניות",
  tasks: "משימות",
  donations: "תרומות",
  staff: "משתמשים",
  staff_invites: "הזמנות משתמשים",
  settings: "הגדרות",
  fallen: "נופלים",
  fallen_family: "משפחות הנופלים",
  care_statuses: "רשימת מצבי קשר",
  contact_types: "רשימת סוגי קשר",
  update_links: "קישורי עדכון עצמי",
  impact_report: "דוח אימפקט",
};

const FIELD_LABELS: Record<string, string> = {
  first_name: "שם פרטי", last_name: "שם משפחה", phone: "טלפון", phone_status: "תקינות טלפון", email: "דוא״ל",
  cohort_id: "מחזור", region_id: "אזור", city: "יישוב", birth_date: "תאריך לידה", owner_id: "אחראי/ת קשר",
  profession: "מקצוע", skills: "כישורים", available_to_help: "זמין/ה לעזור", skills_share_consent: "הסכמה לשיתוף כישורים",
  campaign_consent: "הסכמה לדיוור", notes: "הערות", verified_at: "אומת בתאריך", verified_by: "אומת על ידי",
  archived_at: "הועבר לארכיון", merged_into: "אוחד אל", status_code: "מצב קשר", cadence_days: "תדירות (ימים)",
  next_contact_at: "שיחה הבאה", last_contact_at: "קשר אחרון", snooze_until: "השהיה עד", type_code: "סוג קשר",
  kind: "סוג", outcome: "תוצאה", summary: "סיכום", occurred_at: "מועד", status: "סטטוס", priority: "עדיפות",
  assignee_id: "אחראי/ת", due_at: "מועד יעד", resolved_at: "נסגרה ב", resolution: "מה נעשה", category: "נושא",
  amount: "סכום", donated_at: "תאריך תרומה", campaign_id: "קמפיין", role: "תפקיד", full_name: "שם", is_active: "פעיל/ה",
  cohort_scope: "מחזורים בתחום", region_scope: "אזורים בתחום", value: "ערך", label: "שם", is_sensitive: "רגיש",
  severity: "דחיפות", revoked: "בוטל", used_count: "מספר שימושים", title: "כותרת", from: "מתאריך", to: "עד תאריך",
  format: "פורמט", rows: "שורות", merged: "הרשומה שאוחדה",
};

const PERSON_FIELDS = new Set(["owner_id", "assignee_id", "staff_id", "created_by", "invited_by", "completed_by"]);
const MAX = 60;

type Names = (id: string) => string;

function short(s: string): string {
  return s.length > MAX ? s.slice(0, MAX) + "…" : s;
}

function fmt(key: string, v: unknown, names: Names): string {
  if (v === null || v === undefined || v === "") return "ריק";
  if (typeof v === "boolean") return v ? "כן" : "לא";
  if (PERSON_FIELDS.has(key) && typeof v === "string") return names(v) || "משתמש/ת";
  if (key === "role" && typeof v === "string" && v in ROLE_LABELS) return ROLE_LABELS[v as AppRole];
  if (Array.isArray(v)) return short(v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")) || "ריק";
  if (typeof v === "object") return short(JSON.stringify(v));
  return short(String(v));
}

const isDiff = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2;

/** Readable rendering of audit_log.changes: "field: old → new" for updates, key: value otherwise. */
export function AuditChanges({ action, changes, names }: { action: string; changes: unknown; names: Names }) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return <span className="text-ink-3">—</span>;
  const entries = Object.entries(changes as Record<string, unknown>);
  if (!entries.length) return <span className="text-ink-3">—</span>;
  const diff = action === "update" && entries.every(([, v]) => isDiff(v));
  const skip = new Set(["id", "search_text", "created_at", "updated_at", "token_hash"]);
  const shown = entries.filter(([k]) => !skip.has(k));
  const visible = shown.slice(0, 6);
  return (
    <ul className="flex flex-col gap-0.5 text-[12px] leading-5">
      {action === "delete" && <li className="text-ink-3">תוכן הרשומה שנמחקה:</li>}
      {visible.map(([k, v]) => (
        <li key={k} className="break-words">
          <span className="text-ink-3">{FIELD_LABELS[k] ?? k}:</span>{" "}
          {diff && isDiff(v) ? (
            <>
              <span className="text-ink-2 line-through decoration-ink-3/50">{fmt(k, v[0], names)}</span>
              <span aria-hidden className="text-ink-3 mx-1">←</span><span className="sr-only"> שונה ל: </span>
              <span className="text-ink">{fmt(k, v[1], names)}</span>
            </>
          ) : (
            <span className="text-ink-2">{fmt(k, v, names)}</span>
          )}
        </li>
      ))}
      {shown.length > visible.length && <li className="text-ink-3">ועוד {shown.length - visible.length} שדות</li>}
    </ul>
  );
}

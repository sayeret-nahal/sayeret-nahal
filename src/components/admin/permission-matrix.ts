import type { AppRole } from "@/lib/types";

// Capability matrix — a plain-language mirror of the RLS policies in
// supabase/migrations/0002_security.sql (and the role checks in 0003_logic.sql).
// RLS is the real enforcement; keep this table in sync when policies change.

export const ROLE_ORDER: AppRole[] = ["admin", "manager", "coordinator", "cohort_lead", "donor_coordinator", "volunteer"];

export type Level = "yes" | "partial" | "no";
export interface Cell { level: Level; note?: string }
export interface Capability { key: string; label: string; cells: Record<AppRole, Cell> }

const Y: Cell = { level: "yes" };
const N: Cell = { level: "no" };
const P = (note: string): Cell => ({ level: "partial", note });

const SCOPE = "בתחום שלו/ה";
const OWN = "רק מי שהוקצה לו/ה";

export const CAPABILITIES: Capability[] = [
  {
    key: "view_contacts", label: "צפייה בפרטי אנשים",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: P(`${SCOPE} ומי שבאחריותו/ה`), donor_coordinator: P("תורמים ומי שבאחריותו/ה"), volunteer: P(OWN) },
  },
  {
    key: "edit_contacts", label: "הוספה ועריכה של פרטי אנשים",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: P(SCOPE), donor_coordinator: P("תורמים בלבד"), volunteer: N },
  },
  {
    key: "care", label: "מצב רווחה, מעקב ותגיות רגישות",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: P(SCOPE), donor_coordinator: N, volunteer: P(OWN) },
  },
  {
    key: "log_calls", label: "תיעוד שיחות ומפגשים עם הקהילה",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: P(SCOPE), donor_coordinator: N, volunteer: P(OWN) },
  },
  {
    key: "cases", label: "פניות ודיווחי חשש",
    cells: {
      admin: Y, manager: Y, coordinator: Y,
      cohort_lead: P("של אנשים בתחום, ופניות שהוקצו לו/ה או שפתח/ה"),
      donor_coordinator: N,
      volunteer: P("שהוקצו לו/ה או שפתח/ה"),
    },
  },
  {
    key: "tasks", label: "משימות של אחרים",
    cells: { admin: Y, manager: Y, coordinator: P("משימות שקשורות לאנשים"), cohort_lead: P("משימות של אנשים בתחום"), donor_coordinator: P("רק שלו/ה"), volunteer: P("רק שלו/ה") },
  },
  {
    key: "donors", label: "תרומות, תורמים וקמפיינים",
    cells: { admin: Y, manager: Y, coordinator: N, cohort_lead: N, donor_coordinator: Y, volunteer: N },
  },
  {
    key: "import", label: "ייבוא מקבצי אקסל",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: N, donor_coordinator: Y, volunteer: N },
  },
  {
    key: "export", label: "ייצוא רשימות עם פרטים אישיים",
    cells: { admin: Y, manager: Y, coordinator: N, cohort_lead: N, donor_coordinator: N, volunteer: N },
  },
  {
    key: "merge", label: "איחוד רשומות כפולות",
    cells: { admin: Y, manager: Y, coordinator: P("סימון בלבד, בלי איחוד"), cohort_lead: N, donor_coordinator: N, volunteer: N },
  },
  {
    key: "reports", label: "דוחות מסכמים",
    cells: { admin: Y, manager: Y, coordinator: P("בלי נתוני תרומות"), cohort_lead: N, donor_coordinator: P("דוח אימפקט בלבד"), volunteer: N },
  },
  {
    key: "memorials", label: "ניהול נופלים ומשפחות שכולות",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: P("צפייה"), donor_coordinator: P("צפייה בנופלים בלבד"), volunteer: P("צפייה") },
  },
  {
    key: "events", label: "יצירה ועריכה של אירועים",
    cells: { admin: Y, manager: Y, coordinator: Y, cohort_lead: Y, donor_coordinator: Y, volunteer: N },
  },
  {
    key: "delete", label: "מחיקה לצמיתות של אנשים, פניות ותרומות",
    cells: { admin: Y, manager: N, coordinator: N, cohort_lead: N, donor_coordinator: N, volunteer: N },
  },
  {
    key: "admin", label: "משתמשים, הרשאות, הגדרות ויומן פעולות",
    cells: { admin: Y, manager: N, coordinator: N, cohort_lead: N, donor_coordinator: N, volunteer: N },
  },
];

/** One-line summary of what a role can do, for the permissions export. */
export function roleCapabilitySummary(role: AppRole): string {
  return CAPABILITIES
    .filter((c) => c.cells[role].level !== "no")
    .map((c) => (c.cells[role].level === "partial" ? `${c.label} (${c.cells[role].note})` : c.label))
    .join("; ");
}

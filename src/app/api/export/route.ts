import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAuthState } from "@/lib/auth";
import { getLookups, logAccess } from "@/lib/data";
import { todayIL } from "@/lib/dates";
import { CASE_KIND_LABELS, CASE_STATUS_LABELS, KIND_LABELS, OUTCOME_LABELS, PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { perms } from "@/lib/permissions";
import { displayPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import type { Case, Contact, ContactCare, Donation, Fallen, Interaction, OrgEvent, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Cell = string | number | boolean | Date | null;

const PAGE = 1000;

/**
 * Read every row of a table (PostgREST returns at most 1,000 per request). RLS applies.
 * `order` must end with a unique column so pages never overlap or skip rows.
 */
async function readAll<T>(supabase: Supabase, table: string, select: string, order: string[] = ["id"], onlyUnmerged = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(select);
    if (onlyUnmerged) q = q.is("merged_into", null);
    for (const col of order) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const IL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Excel has no time zones: write dates as Israeli wall-clock time (date-only values stay as they are). */
function date(v: string | null | undefined): Date | null {
  if (!v) return null;
  if (v.length === 10) return new Date(`${v}T00:00:00Z`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(IL_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)));
}
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : v ? "כן" : "לא");

function addSheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; width?: number; date?: boolean; time?: boolean }[], rows: Cell[][]) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    width: c.width ?? 16,
    style: c.date ? { numFmt: c.time ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy" } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle" };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return rows.length;
}

export async function GET() {
  const s = await getAuthState();
  if (!s.user || !s.staff || !s.staff.is_active) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  if ((s.requireMfa || s.nextAal === "aal2") && s.aal !== "aal2") return NextResponse.json({ error: "נדרש אימות דו־שלבי" }, { status: 403 });
  const role = s.staff.role;
  if (!perms.exportData(role)) return NextResponse.json({ error: "אין לך הרשאה לייצא נתונים" }, { status: 403 });

  const supabase = await createClient();
  const lookups = await getLookups();
  const withDonors = perms.manageDonors(role);
  const withCare = perms.seeCare(role);

  type ContactRow = Contact & { contact_type_links: { type_code: string }[] };
  let contacts: ContactRow[];
  let care: ContactCare[] = [];
  let interactions: Interaction[];
  let cases: Case[] = [];
  let tasks: Task[];
  let donations: Donation[] = [];
  let campaigns: { id: number; name: string }[] = [];
  let fallen: Fallen[];
  let events: OrgEvent[];
  try {
    [contacts, care, interactions, cases, tasks, donations, campaigns, fallen, events] = await Promise.all([
      readAll<ContactRow>(supabase, "contacts", "*, contact_type_links(type_code)", ["last_name", "first_name", "id"], true),
      withCare ? readAll<ContactCare>(supabase, "contact_care", "*", ["contact_id"]) : Promise.resolve([]),
      readAll<Interaction>(supabase, "interactions", "*", ["occurred_at", "id"]),
      perms.seeCases(role) ? readAll<Case>(supabase, "cases", "*", ["opened_at", "id"]) : Promise.resolve([]),
      readAll<Task>(supabase, "tasks", "*", ["created_at", "id"]),
      withDonors ? readAll<Donation>(supabase, "donations", "*", ["donated_at", "id"]) : Promise.resolve([]),
      withDonors ? readAll<{ id: number; name: string }>(supabase, "campaigns", "id,name") : Promise.resolve([]),
      readAll<Fallen>(supabase, "fallen", "*", ["death_date", "id"]),
      readAll<OrgEvent>(supabase, "events", "*", ["starts_at", "id"]),
    ]);
  } catch {
    return NextResponse.json({ error: "הייצוא נכשל בקריאת הנתונים. נסו שוב." }, { status: 500 });
  }

  const name = new Map(contacts.map((c) => [c.id, c.full_name]));
  const person = (id: string | null) => (id ? name.get(id) ?? "" : "");
  const campaign = new Map(campaigns.map((c) => [c.id, c.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Nahal CRM";
  wb.created = new Date();
  const counts: Record<string, number> = {};

  counts["אנשים"] = addSheet(wb, "אנשים", [
    { header: "שם פרטי" }, { header: "שם משפחה" }, { header: "טלפון", width: 15 }, { header: "מצב הטלפון", width: 11 },
    { header: "דוא״ל", width: 26 }, { header: "מחזור" }, { header: "אזור" }, { header: "יישוב" },
    { header: "תאריך לידה", date: true, width: 12 }, { header: "אחראי/ת" }, { header: "סוגי קשר", width: 24 },
    { header: "מקצוע" }, { header: "כישורים", width: 24 }, { header: "זמין/ה לעזור", width: 11 },
    { header: "הסכמה לפניות תרומה", width: 14 }, { header: "הערות", width: 40 }, { header: "מקור", width: 13 },
    { header: "אומת לאחרונה", date: true, width: 13 }, { header: "בארכיון", width: 9 }, { header: "נתוני דוגמה", width: 10 },
    { header: "נוצר", date: true, width: 12 }, { header: "מזהה", width: 38 },
  ], contacts.map((c) => [
    c.first_name, c.last_name, displayPhone(c.phone), c.phone_status === "invalid" ? "לא תקין" : c.phone_status === "valid" ? "תקין" : "",
    c.email, lookups.cohortLabel(c.cohort_id), lookups.regionLabel(c.region_id), c.city,
    date(c.birth_date), lookups.staffName(c.owner_id),
    (c.contact_type_links ?? []).map((t) => lookups.typeLabel(t.type_code)).join(", "),
    c.profession, (c.skills ?? []).join(", "), yesNo(c.available_to_help), yesNo(c.campaign_consent),
    c.notes, SOURCE_LABELS[c.source] ?? c.source, date(c.verified_at), yesNo(!!c.archived_at), yesNo(c.is_demo),
    date(c.created_at), c.id,
  ]));

  if (withCare) {
    counts["מצב קשר"] = addSheet(wb, "מצב קשר", [
      { header: "שם", width: 22 }, { header: "מצב" }, { header: "תדירות (ימים)", width: 12 },
      { header: "קשר אחרון", date: true, width: 13 }, { header: "שיחה הבאה", date: true, width: 13 }, { header: "נדחה עד", date: true, width: 12 },
    ], care.map((r) => [
      person(r.contact_id), lookups.status(r.status_code)?.label ?? r.status_code, r.cadence_days,
      date(r.last_contact_at), date(r.next_contact_at), date(r.snooze_until),
    ]));
  }

  counts["שיחות"] = addSheet(wb, "שיחות", [
    { header: "מתי", date: true, time: true, width: 16 }, { header: "שם", width: 22 }, { header: "סוג" }, { header: "תוצאה", width: 18 },
    { header: "הקשר", width: 10 }, { header: "סיכום", width: 50 }, { header: "תועד על ידי" },
  ], interactions.map((i) => [
    date(i.occurred_at), person(i.contact_id), KIND_LABELS[i.kind] ?? i.kind, i.outcome ? OUTCOME_LABELS[i.outcome] ?? i.outcome : "",
    i.context === "donor" ? "תורמים" : "קהילה", i.summary, lookups.staffName(i.staff_id),
  ]));

  if (perms.seeCases(role)) {
    counts["פניות"] = addSheet(wb, "פניות", [
      { header: "מספר", width: 8 }, { header: "סוג", width: 10 }, { header: "מצב", width: 12 }, { header: "דחיפות", width: 9 },
      { header: "נושא" }, { header: "איש קשר", width: 20 }, { header: "על מי (אם לא מזוהה)", width: 18 },
      { header: "פונה", width: 16 }, { header: "טלפון הפונה", width: 15 }, { header: "דוא״ל הפונה", width: 22 },
      { header: "הודעה", width: 50 }, { header: "מקור", width: 14 }, { header: "אחראי/ת" },
      { header: "נפתחה", date: true, time: true, width: 16 }, { header: "יעד לטיפול", date: true, time: true, width: 16 },
      { header: "טופלה", date: true, time: true, width: 16 }, { header: "סיכום הטיפול", width: 40 }, { header: "נתוני דוגמה", width: 10 },
    ], cases.map((c) => [
      c.ref_no, CASE_KIND_LABELS[c.kind], CASE_STATUS_LABELS[c.status], PRIORITY_LABELS[c.priority],
      c.category, person(c.contact_id), c.subject_name, c.requester_name, displayPhone(c.requester_phone) || c.requester_phone,
      c.requester_email, c.message, c.source, lookups.staffName(c.assignee_id),
      date(c.opened_at), date(c.due_at), date(c.resolved_at), c.resolution, yesNo(c.is_demo),
    ]));
  }

  counts["משימות"] = addSheet(wb, "משימות", [
    { header: "משימה", width: 36 }, { header: "איש קשר", width: 20 }, { header: "אחראי/ת" }, { header: "תאריך יעד", date: true, width: 12 },
    { header: "עדיפות", width: 9 }, { header: "מצב", width: 9 }, { header: "נוצרה", date: true, width: 12 }, { header: "הושלמה", date: true, width: 12 },
  ], tasks.map((t) => [
    t.title, person(t.contact_id), lookups.staffName(t.assignee_id), date(t.due_date), PRIORITY_LABELS[t.priority],
    t.status === "done" ? "בוצעה" : t.status === "cancelled" ? "בוטלה" : "פתוחה", date(t.created_at), date(t.completed_at),
  ]));

  if (withDonors) {
    counts["תרומות"] = addSheet(wb, "תרומות", [
      { header: "תאריך", date: true, width: 12 }, { header: "תורם/ת", width: 22 }, { header: "סכום", width: 11 }, { header: "מטבע", width: 7 },
      { header: "אמצעי תשלום" }, { header: "קמפיין", width: 20 }, { header: "הוראת קבע", width: 10 }, { header: "אסמכתא", width: 14 },
      { header: "הערות", width: 30 }, { header: "נתוני דוגמה", width: 10 },
    ], donations.map((d) => [
      date(d.donated_at), person(d.contact_id), Number(d.amount), d.currency, d.method,
      d.campaign_id ? campaign.get(d.campaign_id) ?? "" : "", yesNo(d.is_recurring), d.external_ref, d.notes, yesNo(d.is_demo),
    ]));
  }

  counts["חללים"] = addSheet(wb, "חללים", [
    { header: "שם פרטי" }, { header: "שם משפחה" }, { header: "מחזור" }, { header: "תאריך נפילה", date: true, width: 13 },
    { header: "אחרי השקיעה", width: 11 }, { header: "אחראי/ת" }, { header: "הערות", width: 40 }, { header: "נתוני דוגמה", width: 10 },
  ], fallen.map((f) => [
    f.first_name, f.last_name, lookups.cohortLabel(f.cohort_id), date(f.death_date), yesNo(f.after_sunset),
    lookups.staffName(f.owner_id), f.notes, yesNo(f.is_demo),
  ]));

  counts["אירועים"] = addSheet(wb, "אירועים", [
    { header: "אירוע", width: 30 }, { header: "מתחיל", date: true, time: true, width: 16 }, { header: "מסתיים", date: true, time: true, width: 16 },
    { header: "מקום", width: 20 }, { header: "מחזור" }, { header: "אזור" }, { header: "תיאור", width: 40 }, { header: "נתוני דוגמה", width: 10 },
  ], events.map((e) => [
    e.title, date(e.starts_at), date(e.ends_at), e.location, lookups.cohortLabel(e.cohort_id), lookups.regionLabel(e.region_id),
    e.description, yesNo(e.is_demo),
  ]));

  const buffer = await wb.xlsx.writeBuffer();
  const sheets = Object.keys(counts);
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  // Required access-log entry for exports (data-security regulations) — written before the file leaves the server.
  // the regulations require every export to be logged: refuse if it could not be
  if (!(await logAccess("export", "all", undefined, { sheets, rows, per_sheet: counts }))) {
    return new Response("לא ניתן היה לתעד את הייצוא ביומן הפעולות, ולכן הוא בוטל. נסו שוב.", { status: 503 });
  }

  const fileName = `nahal-crm-export-${todayIL()}.xlsx`;
  return new NextResponse(new Uint8Array(buffer as unknown as Uint8Array), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

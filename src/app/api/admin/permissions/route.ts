import { NextResponse } from "next/server";
import { getAuthState } from "@/lib/auth";
import { getLookups, logAccess } from "@/lib/data";
import { formatDate, formatDateTime, todayIL } from "@/lib/dates";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/labels";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";
import { roleCapabilitySummary } from "@/components/admin/permission-matrix";

type Row = { email: string; full_name: string; role: AppRole; cohort_scope: number[]; region_scope: number[]; created_at: string };

/** Escape a CSV cell; neutralise spreadsheet formulas (cells starting with = + - @). */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Up-to-date list of who holds which permission (required by the data-security regulations). Admin only. */
export async function GET() {
  const s = await getAuthState();
  if (!s.user || !s.staff || !s.staff.is_active) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  if ((s.requireMfa || s.nextAal === "aal2") && s.aal !== "aal2") return NextResponse.json({ error: "נדרש אימות דו-שלבי" }, { status: 401 });
  if (!perms.admin(s.staff.role)) return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });

  const supabase = await createClient();
  const [lookups, staffRes, invitesRes] = await Promise.all([
    getLookups(),
    supabase.from("staff").select("email,full_name,role,cohort_scope,region_scope,created_at,is_active").order("full_name").returns<(Row & { is_active: boolean })[]>(),
    supabase.from("staff_invites").select("email,full_name,role,cohort_scope,region_scope,created_at").order("full_name").returns<Row[]>(),
  ]);
  if (staffRes.error || invitesRes.error) return NextResponse.json({ error: "טעינת הנתונים נכשלה" }, { status: 500 });

  const scope = (r: Row) => [
    ...r.cohort_scope.map((id) => lookups.cohortLabel(id) || `מחזור #${id}`),
    ...r.region_scope.map((id) => lookups.regionLabel(id) || `אזור #${id}`),
  ].join(", ");

  const header = ["שם", "דוא\"ל", "תפקיד", "מצב", "תחום (מחזורים / אזורים)", "תיאור התפקיד", "הרשאות", "נוסף/הוזמן בתאריך"];
  const rows: string[][] = [
    ...(staffRes.data ?? []).map((r) => [
      r.full_name, r.email, ROLE_LABELS[r.role], r.is_active ? "פעיל/ה" : "מושבת/ת — אין גישה", scope(r),
      ROLE_DESCRIPTIONS[r.role], r.is_active ? roleCapabilitySummary(r.role) : "אין", formatDate(r.created_at),
    ]),
    ...(invitesRes.data ?? []).map((r) => [
      r.full_name, r.email, ROLE_LABELS[r.role], "הזמנה ממתינה — עדיין לא נרשם/ה", scope(r),
      ROLE_DESCRIPTIONS[r.role], `לאחר ההרשמה: ${roleCapabilitySummary(r.role)}`, formatDate(r.created_at),
    ]),
  ];

  const lines = [
    [`רשימת בעלי הרשאות — הופקה ${formatDateTime(new Date().toISOString())} על ידי ${s.staff.full_name}`],
    [],
    header,
    ...rows,
  ].map((line) => line.map(cell).join(","));
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  // the regulations require every export to be logged: refuse if it could not be
  if (!(await logAccess("export", "staff", undefined, { kind: "permissions_list", rows: rows.length }))) {
    return new Response("לא ניתן היה לתעד את הייצוא ביומן הפעולות, ולכן הוא בוטל. נסו שוב.", { status: 503 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="permissions-${todayIL()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

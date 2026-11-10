import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthState } from "@/lib/auth";
import { logAccess } from "@/lib/data";
import { formatDateTime, todayIL } from "@/lib/dates";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatMetric, parseImpact, visibleMetrics } from "@/components/reports/metrics";
import { rangeLabel, validateRange } from "@/components/reports/period";

/** Impact report as .xlsx (metric, value, definition). Aggregates only — no personal data. */
export async function GET(req: NextRequest) {
  const s = await getAuthState();
  if (!s.user || !s.staff || !s.staff.is_active) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  if ((s.requireMfa || s.nextAal === "aal2") && s.aal !== "aal2") return NextResponse.json({ error: "נדרש אימות דו-שלבי" }, { status: 401 });
  const role = s.staff.role;
  if (!perms.reports(role)) return NextResponse.json({ error: "אין הרשאה לדוחות" }, { status: 403 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const invalid = validateRange(from, to, todayIL());
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const supabase = await createClient();
  const [{ data, error }, org] = await Promise.all([
    supabase.rpc("impact_report_safe", { p_from: from, p_to: to }),
    supabase.from("settings").select("value").eq("key", "org_name").maybeSingle<{ value: string }>(),
  ]);
  const report = error ? null : parseImpact(data);
  if (!report) return NextResponse.json({ error: "לא הצלחנו להפיק את הדוח" }, { status: 500 });
  const orgName = typeof org.data?.value === "string" ? org.data.value : "עמותת סיירת נחל";
  const metrics = visibleMetrics(perms.manageDonors(role));

  const wb = new ExcelJS.Workbook();
  wb.creator = orgName;
  wb.created = new Date();
  const ws = wb.addWorksheet("דוח אימפקט", { views: [{ rightToLeft: true }] });
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 100;

  ws.addRow([orgName]).font = { bold: true, size: 14 };
  ws.addRow([`דוח אימפקט · ${rangeLabel(from!, to!)}`]).font = { bold: true, size: 12 };
  ws.addRow([`הופק: ${formatDateTime(new Date().toISOString())}`]).font = { color: { argb: "FF6B7570" } };
  if (report.includes_demo) {
    const w = ws.addRow(["אזהרה: הדוח כולל נתוני דוגמה — אין לשלוח אותו. יש למחוק את נתוני הדוגמה ולהפיק את הדוח מחדש."]);
    w.font = { bold: true, color: { argb: "FFB42318" } };
    ws.mergeCells(w.number, 1, w.number, 3);
  }
  ws.addRow([]);

  const header = ws.addRow(["מדד", "ערך", "הגדרה — מה בדיוק נספר"]);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1EC" } };
    c.border = { bottom: { style: "thin", color: { argb: "FFCFD4CE" } } };
  });

  for (const m of metrics) {
    const label = m.scope === "now" ? `${m.label} (נכון להיום)` : m.label;
    const row = ws.addRow([label, report[m.key], m.definition]);
    const v = row.getCell(2);
    v.numFmt = m.currency ? '"₪"#,##0' : "#,##0";
    v.alignment = { horizontal: "right" };
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    row.getCell(1).alignment = { vertical: "top" };
    if (m.key === "cases_resolved_on_time" && report.cases_resolved > 0) {
      row.getCell(3).value = `${m.definition} (${Math.round((report.cases_resolved_on_time / report.cases_resolved) * 100)}% מ-${formatMetric(m, report.cases_resolved)} הפניות שנסגרו)`;
    }
  }

  ws.addRow([]);
  ws.addRow(["המספרים נספרים מהרשומות במערכת וכוללים רק פעילות שתועדה. התקופה כוללת את יום ההתחלה ואת יום הסיום. הדוח אינו כולל פרטים מזהים."])
    .font = { italic: true, color: { argb: "FF6B7570" } };

  const buf = await wb.xlsx.writeBuffer();
  // the regulations require every export to be logged: refuse if it could not be
  if (!(await logAccess("report", "impact_report_safe", undefined, { from, to, format: "xlsx" }))) {
    return new Response("לא ניתן היה לתעד את הייצוא ביומן הפעולות, ולכן הוא בוטל. נסו שוב.", { status: 503 });
  }

  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="impact-report-${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

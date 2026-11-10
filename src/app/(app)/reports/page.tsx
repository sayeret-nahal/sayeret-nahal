import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, PageHeader, cx } from "@/components/ui";
import { ExportAllLink } from "@/components/reports/export-all-link";
import { ImpactReportView } from "@/components/reports/impact-report";
import { OperationalSnapshot } from "@/components/reports/operational-snapshot";
import { PeriodPicker } from "@/components/reports/period-picker";
import { resolvePeriod } from "@/components/reports/period";
import { parseImpact } from "@/components/reports/metrics";
import { requireStaff } from "@/lib/auth";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { todayIL } from "@/lib/dates";

export const metadata: Metadata = { title: "דוחות" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const role = staff.role;
  if (!perms.reports(role)) redirect("/");

  const canOps = perms.seeAllCases(role); // admin / manager / coordinator
  const view = sp.view === "ops" && canOps ? "ops" : "impact";

  const tabs = canOps ? (
    <nav aria-label="סוג הדוח" className="no-print border-b border-line mb-6">
      <ul className="flex gap-1 -mb-px">
        {([["impact", "דוח אימפקט", "/reports"], ["ops", "תמונת מצב תפעולית", "/reports?view=ops"]] as const).map(([key, label, href]) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={view === key ? "page" : undefined}
              className={cx(
                "inline-flex items-center h-10 px-3 text-sm border-b-2 transition-colors",
                view === key ? "border-brand text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  ) : null;

  if (view === "ops") {
    return (
      <>
        <PageHeader title="דוחות" description="תמונת מצב לצוות: מה פתוח, מה באיחור ומי צריך עזרה. לשימוש פנימי בלבד."
          actions={perms.exportData(staff.role) ? <ExportAllLink /> : undefined} />
        {tabs}
        <OperationalSnapshot />
      </>
    );
  }

  const today = todayIL();
  const period = resolvePeriod(sp, today);
  const supabase = await createClient();
  const [{ data, error }, org] = await Promise.all([
    supabase.rpc("impact_report_safe", { p_from: period.from, p_to: period.to }),
    supabase.from("settings").select("value").eq("key", "org_name").maybeSingle<{ value: string }>(),
  ]);
  const report = error ? null : parseImpact(data);
  const orgName = typeof org.data?.value === "string" ? org.data.value : "עמותת סיירת נחל";

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="דוחות"
          description="דוח אימפקט לתורמים ולשותפים: מספרים בלבד, עם הגדרה מדויקת לכל מספר, כך שאפשר לבדוק כל נתון."
          actions={perms.exportData(role) ? <ExportAllLink /> : undefined}
        />
      </div>
      {tabs}
      <PeriodPicker period={period} today={today} />
      {period.error && (
        <div className="no-print mb-4"><Notice tone="danger" title="התקופה שנבחרה לא תקינה">{period.error} מוצג במקומה החודש הנוכחי.</Notice></div>
      )}
      {report ? (
        <ImpactReportView report={report} period={period} orgName={orgName} role={role} generatedAt={new Date().toISOString()} />
      ) : (
        <Notice tone="danger" title="לא הצלחנו להפיק את הדוח">רעננו את הדף ונסו שוב. אם זה חוזר, פנו למנהל/ת המערכת.</Notice>
      )}
    </>
  );
}

import { Download } from "lucide-react";
import { Badge, Notice, Stat, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { perms } from "@/lib/permissions";
import type { AppRole } from "@/lib/types";
import { GROUP_LABELS, formatMetric, visibleMetrics, type ImpactKey, type ImpactReport, type MetricGroup } from "./metrics";
import type { Period } from "./period";
import { ContextNotes, PrintButton } from "./print-tools";

/** Where each metric can be checked in the app, for roles that see the whole list. */
function metricLink(key: ImpactKey, role: AppRole): string | undefined {
  const all = perms.seeAllCases(role); // admin / manager / coordinator see every contact and case
  switch (key) {
    case "community_size": return all ? "/contacts" : undefined;
    case "volunteers": return all ? "/contacts?type=volunteer" : undefined;
    case "helpers_available": return all ? "/skills" : undefined;
    case "events_held": return "/calendar";
    case "cases_opened":
    case "cases_resolved":
    case "cases_resolved_on_time":
    case "talk_requests": return all ? "/cases" : undefined;
    case "donations_count":
    case "donations_sum":
    case "donors_unique": return perms.manageDonors(role) ? "/donors" : undefined;
    default: return undefined; // interaction counts have no single list
  }
}

const GROUP_ORDER: MetricGroup[] = ["contact", "cases", "community", "donations"];

export function ImpactReportView({ report, period, orgName, role, generatedAt }: {
  report: ImpactReport; period: Period; orgName: string; role: AppRole; generatedAt: string;
}) {
  const metrics = visibleMetrics(perms.manageDonors(role));
  const onTimePct = report.cases_resolved > 0 ? Math.round((report.cases_resolved_on_time / report.cases_resolved) * 100) : null;
  const xlsxHref = `/api/reports/impact?from=${period.from}&to=${period.to}`;

  return (
    <div className="flex flex-col gap-6">
      {/* print-only header */}
      <header className="hidden print:block border-b border-line pb-3">
        <p className="text-sm text-ink-2">{orgName}</p>
        <h1 className="text-2xl font-semibold mt-0.5">דוח אימפקט · {period.label}</h1>
        <p className="text-[13px] text-ink-3 mt-1">הופק בתאריך {formatDateTime(generatedAt)}</p>
      </header>

      {report.includes_demo && (
        <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-sm">
          <p className="font-semibold text-danger">הדוח כולל נתוני דוגמה — אין לשלוח אותו לתורמים</p>
          <p className="text-ink-2 mt-0.5">
            במערכת יש עדיין רשומות לדוגמה, והן נספרות במספרים שלמטה.{" "}
            {perms.admin(role)
              ? "מחקו אותן (ניהול ← נתוני דוגמה) והפיקו את הדוח מחדש."
              : "בקשו ממנהל/ת המערכת למחוק אותן, ואז הפיקו את הדוח מחדש."}
          </p>
        </div>
      )}

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          תקופה: <strong className="text-ink">{period.label}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          <a href={xlsxHref} className={buttonClass("secondary", "sm")} download>
            <Download className="size-4" aria-hidden />
            הורדה לאקסל
          </a>
        </div>
      </div>

      {GROUP_ORDER.map((g) => {
        const items = metrics.filter((m) => m.group === g);
        if (!items.length) return null;
        const headingId = `impact-${g}`;
        return (
          <section key={g} aria-labelledby={headingId} className="break-inside-avoid">
            <div className="mb-3">
              <h2 id={headingId} className="text-[15px] font-semibold text-ink">{GROUP_LABELS[g].title}</h2>
              <p className="text-[13px] text-ink-3">{GROUP_LABELS[g].subtitle}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-2">
              {items.map((m) => {
                const href = metricLink(m.key, role);
                const extra = m.key === "cases_resolved_on_time" && onTimePct !== null ? ` (${onTimePct}% מהפניות שנסגרו)` : "";
                return (
                  <div key={m.key} className="break-inside-avoid [&>*]:h-full">
                    <Stat
                      label={m.label}
                      value={<>{formatMetric(m, report[m.key])}<span className="text-sm font-normal text-ink-2">{extra}</span></>}
                      href={href}
                      hint={
                        <span className="flex flex-col gap-1 mt-1 leading-5">
                          {m.scope === "now" && <span><Badge>נכון להיום</Badge></span>}
                          <span>{m.definition}</span>
                          {href && <span className="no-print text-brand">פתיחת הרשימה במערכת ←</span>}
                        </span>
                      }
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <ContextNotes />

      <section aria-labelledby="impact-method" className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 text-[13px] text-ink-2 break-inside-avoid">
        <h2 id="impact-method" className="text-sm font-semibold text-ink mb-1.5">איך נספרים המספרים</h2>
        <ul className="list-disc ps-5 flex flex-col gap-1">
          <li>המספרים נספרים ישירות מהרשומות במערכת. הם כוללים רק מה שתועד, ולכן הפעילות בפועל יכולה להיות רחבה יותר.</li>
          <li>התקופה כוללת את יום ההתחלה ואת יום הסיום. מדדים שמסומנים &quot;נכון להיום&quot; מתארים את המצב ביום הפקת הדוח.</li>
          <li>הדוח מסכם מספרים בלבד ואינו כולל שמות או פרטים מזהים של אף אדם.</li>
        </ul>
      </section>

      {!report.includes_demo && (
        <div className="no-print">
          <Notice tone="neutral">לפני שליחה: עברו על המספרים, והוסיפו הקשר כללי בתיבת ההערות אם צריך. לא מוסיפים סיפורים אישיים או פרטים מזהים.</Notice>
        </div>
      )}
    </div>
  );
}

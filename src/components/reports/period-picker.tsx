import Link from "next/link";
import { Input, buttonClass, cx } from "@/components/ui";
import { PERIOD_OPTIONS, type Period } from "./period";

/** Period selector: preset links + a custom from/to GET form (works without JavaScript). */
export function PeriodPicker({ period, today }: { period: Period; today: string }) {
  return (
    <div className="no-print flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-5">
      <nav aria-label="תקופת הדוח">
        <ul className="inline-flex flex-wrap gap-1 rounded-lg bg-muted-soft p-1">
          {PERIOD_OPTIONS.map((o) => {
            const active = period.key === o.key;
            return (
              <li key={o.key}>
                <Link
                  href={`/reports?period=${o.key}`}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "inline-flex items-center h-9 px-3 rounded-md text-sm transition-colors",
                    active ? "bg-surface text-ink font-medium shadow-sm" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {o.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form method="get" action="/reports" className="flex flex-wrap items-end gap-2" aria-label="תקופה מותאמת">
        <input type="hidden" name="period" value="custom" />
        <div className="flex flex-col gap-1">
          <label htmlFor="report-from" className="text-[12px] text-ink-2">מתאריך</label>
          <Input id="report-from" name="from" type="date" max={today} defaultValue={period.key === "custom" ? period.from : ""} required className="h-9 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="report-to" className="text-[12px] text-ink-2">עד תאריך</label>
          <Input id="report-to" name="to" type="date" max={today} defaultValue={period.key === "custom" ? period.to : ""} required className="h-9 w-40" />
        </div>
        <button type="submit" className={buttonClass(period.key === "custom" ? "primary" : "secondary", "sm", "h-9")}>הצגת התקופה</button>
      </form>
    </div>
  );
}

import { addDays, formatDate, todayIL } from "@/lib/dates";

export type PeriodKey = "month" | "last_month" | "quarter" | "year" | "custom";

export const PERIOD_OPTIONS: { key: Exclude<PeriodKey, "custom">; label: string }[] = [
  { key: "month", label: "החודש" },
  { key: "last_month", label: "החודש הקודם" },
  { key: "quarter", label: "הרבעון" },
  { key: "year", label: "השנה" },
];

export interface Period {
  key: PeriodKey;
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  label: string;
  error?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366 * 5;

export function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !ISO.test(v)) return false;
  const d = new Date(v + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const pad = (n: number) => String(n).padStart(2, "0");
const monthName = (y: number, m: number) =>
  new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));

/** Human label for a date range, e.g. "1.11.2026 – 30.11.2026". */
export function rangeLabel(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/** Validate a custom range. Returns an error message in Hebrew, or null. */
export function validateRange(from: string | null | undefined, to: string | null | undefined, today = todayIL()): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "נא לבחור תאריך התחלה ותאריך סיום תקינים.";
  if (from > to) return "תאריך ההתחלה מאוחר מתאריך הסיום.";
  if (to > today) return "תאריך הסיום לא יכול להיות אחרי היום — הדוח סופר רק מה שכבר קרה.";
  const days = (Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000;
  if (days > MAX_DAYS) return "אפשר להפיק דוח לתקופה של עד חמש שנים.";
  return null;
}

/** Resolve the period from GET params. Current periods end today (nothing in the future is counted). */
export function resolvePeriod(sp: { period?: string; from?: string; to?: string }, today = todayIL()): Period {
  const [y, m] = today.split("-").map(Number);
  const key = (["month", "last_month", "quarter", "year", "custom"] as const).find((k) => k === sp.period)
    ?? (sp.from || sp.to ? "custom" : "month");

  switch (key) {
    case "last_month": {
      const firstThis = `${y}-${pad(m)}-01`;
      const to = addDays(firstThis, -1);
      const [py, pm] = to.split("-").map(Number);
      return { key, from: `${py}-${pad(pm)}-01`, to, label: monthName(py, pm) };
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3);
      return { key, from: `${y}-${pad(q * 3 + 1)}-01`, to: today, label: `רבעון ${q + 1} ${y} (עד היום)` };
    }
    case "year":
      return { key, from: `${y}-01-01`, to: today, label: `שנת ${y} (עד היום)` };
    case "custom": {
      const error = validateRange(sp.from, sp.to, today);
      if (error) {
        return { key, from: `${y}-${pad(m)}-01`, to: today, label: `${monthName(y, m)} (עד היום)`, error };
      }
      return { key, from: sp.from!, to: sp.to!, label: rangeLabel(sp.from!, sp.to!) };
    }
    default:
      return { key: "month", from: `${y}-${pad(m)}-01`, to: today, label: `${monthName(y, m)} (עד היום)` };
  }
}

import { HDate, HebrewCalendar } from "@hebcal/core";

const TZ = "Asia/Jerusalem";

/** Today's date in Israel as YYYY-MM-DD. */
export function todayIL(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today (IL) to the given date; negative = past. */
export function daysFromToday(isoDate: string): number {
  const a = Date.parse(todayIL() + "T12:00:00Z");
  const b = Date.parse(isoDate.slice(0, 10) + "T12:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "";
  const d = value.length === 10 ? new Date(value + "T12:00:00Z") : new Date(value);
  return new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", ...opts }).format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ, day: "numeric", month: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

/** "יום", "יומיים", "5 ימים" */
export function daysText(n: number): string {
  return n === 1 ? "יום" : n === 2 ? "יומיים" : `${n} ימים`;
}

/** "היום", "מחר", "לפני 3 ימים", "בעוד שבוע" … */
export function relativeDay(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const n = daysFromToday(isoDate);
  if (n === 0) return "היום";
  if (n === 1) return "מחר";
  if (n === -1) return "אתמול";
  const abs = Math.abs(n);
  const unit = abs === 2 ? "יומיים" : abs < 14 ? `${abs} ימים` : abs < 60 ? `${Math.round(abs / 7)} שבועות` : `${Math.round(abs / 30)} חודשים`;
  return n > 0 ? `בעוד ${unit}` : `לפני ${unit}`;
}

/** Hebrew rendering of a Gregorian date, e.g. "כ״ב תמוז תשע״ד". */
export function hebrewDate(isoDate: string, afterSunset = false): string {
  let hd = new HDate(new Date(isoDate + "T12:00:00"));
  if (afterSunset) hd = hd.next();
  return stripNiqqud(hd.renderGematriya());
}

function stripNiqqud(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

export interface MemorialDates {
  /** Next Hebrew-calendar memorial (azkara / yahrzeit), Gregorian YYYY-MM-DD. */
  nextAzkara: string;
  azkaraHebrew: string;
  /** Next Gregorian anniversary. */
  nextAnniversary: string;
  /** Number of years being marked at the next azkara. */
  years: number;
}

/**
 * Next memorial dates on or after `from`. Uses hebcal's yahrzeit rules
 * (Adar in leap years, 30 Cheshvan/Kislev, etc.). A death after sunset belongs to the next Hebrew day.
 */
export function memorialDates(deathDate: string, afterSunset: boolean, from: string = todayIL()): MemorialDates {
  let death = new HDate(new Date(deathDate + "T12:00:00"));
  if (afterSunset) death = death.next();
  const fromH = new HDate(new Date(from + "T12:00:00"));
  let azkara: HDate | undefined;
  for (let y = fromH.getFullYear(); y <= fromH.getFullYear() + 2 && !azkara; y++) {
    const cand = HebrewCalendar.getYahrzeit(y, death);
    if (cand && cand.abs() >= fromH.abs()) azkara = cand;
  }
  const azDate = azkara!.greg();
  const nextAzkara = isoLocal(azDate);

  const [, dm, dd] = deathDate.split("-").map(Number);
  const [fy] = from.split("-").map(Number);
  let ann = `${fy}-${String(dm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  if (ann < from) ann = `${fy + 1}-${String(dm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  // 29 Feb in a non-leap year → 28 Feb
  if (Number.isNaN(Date.parse(ann + "T12:00:00Z")) || new Date(ann + "T12:00:00Z").getUTCDate() !== dd) {
    ann = ann.slice(0, 8) + "28";
  }
  return {
    nextAzkara,
    azkaraHebrew: stripNiqqud(azkara!.renderGematriya()),
    nextAnniversary: ann,
    years: azkara!.getFullYear() - death.getFullYear(),
  };
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

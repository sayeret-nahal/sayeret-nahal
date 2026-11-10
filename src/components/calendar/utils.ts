// Small date helpers for the calendar module (pure, usable on server and client).
// Shared date logic lives in @/lib/dates; these only cover Israel-local wall-clock conversions.

const TZ = "Asia/Jerusalem";

function parts(d: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Israel-local calendar date (YYYY-MM-DD) of a timestamp. */
export function ilDate(ts: string): string {
  return parts(new Date(ts)).date;
}

/** Israel-local wall-clock time (HH:MM) of a timestamp. */
export function ilTime(ts: string): string {
  return parts(new Date(ts)).time;
}

/** Israel-local date + time ("2026-11-02", "19:30") → ISO timestamp (handles summer time). */
export function ilLocalToISO(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || "00:00");
  if (!m || !t) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess));
    const [y, mo, d] = p.date.split("-").map(Number);
    const [h, mi] = p.time.split(":").map(Number);
    const shown = Date.UTC(y, mo - 1, d, h, mi);
    guess += wall - shown;
  }
  return new Date(guess).toISOString();
}

/** "נובמבר 2026" */
export function monthLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TZ, month: "long", year: "numeric" }).format(new Date(isoDate + "T12:00:00Z"));
}

/** "יום ב׳" */
export function weekdayShort(isoDate: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "short" }).format(new Date(isoDate + "T12:00:00Z"));
}

/** "יום שני" */
export function weekdayLong(isoDate: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long" }).format(new Date(isoDate + "T12:00:00Z"));
}

/** Last day (Saturday) of the Israeli week (Sunday–Saturday) that contains `isoDate`. */
export function endOfWeek(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + (6 - d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

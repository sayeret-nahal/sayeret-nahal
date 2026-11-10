import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clock, Flame, MapPin, Users } from "lucide-react";
import { Badge, Card, DemoTag, EmptyState, LinkButton, PageHeader, cx } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";
import { AddEventDialog, EditEventDialog } from "@/components/calendar/dialogs";
import { MemorialTaskButton } from "@/components/calendar/memorial-task-button";
import { endOfWeek, ilDate, ilTime, monthLabel, weekdayShort } from "@/components/calendar/utils";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { addDays, daysFromToday, formatDate, hebrewDate, memorialDates, relativeDay, todayIL } from "@/lib/dates";
import type { Fallen } from "@/lib/types";
import { deleteEvent } from "./actions";

export const metadata: Metadata = { title: "תאריכים ואירועים" };

const RANGES = [30, 90, 365] as const;

type EventRow = {
  id: string; title: string; starts_at: string; location: string | null; cohort_id: number | null; region_id: number | null;
  description: string | null; created_by: string | null; is_demo: boolean;
};
type FamilyRow = { fallen_id: string; contact_id: string; relation: string | null; contacts: { id: string; full_name: string } | null };

type Item =
  | { kind: "memorial"; date: string; hebrew: string; fallen: Fallen; azkara: boolean; anniversary: boolean; years: number }
  | { kind: "event"; date: string; hebrew: string; event: EventRow };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff, userId } = await requireStaff();
  const role = staff.role;
  const days = (RANGES as readonly number[]).includes(Number(sp.range)) ? Number(sp.range) : 90;
  const today = todayIL();
  const until = addDays(today, days - 1);
  const weekEnd = endOfWeek(today);
  const lookups = await getLookups();
  const supabase = await createClient();
  const seeFamily = perms.seeCare(role);

  const [fallenRes, eventsRes, familyRes] = await Promise.all([
    supabase.from("fallen").select("*").returns<Fallen[]>(),
    supabase.from("events")
      .select("id,title,starts_at,location,cohort_id,region_id,description,created_by,is_demo")
      .gte("starts_at", addDays(today, -1) + "T00:00:00Z")
      .lte("starts_at", addDays(until, 1) + "T23:59:59Z")
      .order("starts_at")
      .returns<EventRow[]>(),
    seeFamily
      ? supabase.from("fallen_family").select("fallen_id, contact_id, relation, contacts(id, full_name)").returns<FamilyRow[]>()
      : Promise.resolve({ data: [] as FamilyRow[], error: null }),
  ]);

  const familyBy = new Map<string, FamilyRow[]>();
  for (const f of familyRes.data ?? []) {
    if (!f.contacts) continue;
    familyBy.set(f.fallen_id, [...(familyBy.get(f.fallen_id) ?? []), f]);
  }

  const items: Item[] = [];
  for (const f of fallenRes.data ?? []) {
    const m = memorialDates(f.death_date, f.after_sunset, today);
    const deathYear = Number(f.death_date.slice(0, 4));
    const annYears = Number(m.nextAnniversary.slice(0, 4)) - deathYear;
    if (m.nextAzkara === m.nextAnniversary) {
      if (m.nextAzkara <= until && m.years > 0) items.push({ kind: "memorial", date: m.nextAzkara, hebrew: m.azkaraHebrew, fallen: f, azkara: true, anniversary: true, years: m.years });
      continue;
    }
    if (m.nextAzkara <= until && m.years > 0) items.push({ kind: "memorial", date: m.nextAzkara, hebrew: m.azkaraHebrew, fallen: f, azkara: true, anniversary: false, years: m.years });
    if (m.nextAnniversary <= until && annYears > 0) {
      items.push({ kind: "memorial", date: m.nextAnniversary, hebrew: hebrewDate(m.nextAnniversary), fallen: f, azkara: false, anniversary: true, years: annYears });
    }
  }
  for (const e of eventsRes.data ?? []) {
    const d = ilDate(e.starts_at);
    if (d < today || d > until) continue;
    items.push({ kind: "event", date: d, hebrew: hebrewDate(d), event: e });
  }
  items.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1)
      : a.kind !== b.kind ? (a.kind === "memorial" ? -1 : 1)
        : a.kind === "event" && b.kind === "event" ? (a.event.starts_at < b.event.starts_at ? -1 : 1) : 0,
  );

  const months: { key: string; label: string; items: Item[] }[] = [];
  for (const it of items) {
    const key = it.date.slice(0, 7);
    let g = months.find((x) => x.key === key);
    if (!g) { g = { key, label: monthLabel(it.date), items: [] }; months.push(g); }
    g.items.push(it);
  }

  const thisWeek = items.filter((i) => i.date <= weekEnd);
  const memorialsWeek = thisWeek.filter((i) => i.kind === "memorial").length;
  const eventsWeek = thisWeek.filter((i) => i.kind === "event").length;
  const canManageEvents = perms.manageEvents(role);
  const loadError = fallenRes.error || eventsRes.error;

  const addEvent = canManageEvents ? <AddEventDialog cohorts={lookups.cohorts} regions={lookups.regions} defaultDate={today} /> : null;

  return (
    <>
      <PageHeader
        title="תאריכים ואירועים"
        description="ימי אזכרה לפי הלוח העברי, ימי השנה לפי הלוח הלועזי ואירועי הקהילה — כדי שאף משפחה ואף מפגש לא יישכחו."
        actions={
          <>
            <LinkButton href="/calendar/fallen" variant="secondary" size="sm"><Flame className="size-4" aria-hidden />חללי היחידה</LinkButton>
            {addEvent}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <nav aria-label="טווח זמן" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={r === 90 ? "/calendar" : `/calendar?range=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={cx(
                "inline-flex items-center h-9 px-3 rounded-md text-sm",
                r === days ? "bg-brand text-white font-medium" : "text-ink-2 hover:bg-canvas",
              )}
            >
              {r === 365 ? "שנה" : `${r} ימים`}
            </Link>
          ))}
        </nav>
        <p className="text-[13px] text-ink-3">
          {formatDate(today)} – {formatDate(until)} · {items.length.toLocaleString("he-IL")} מועדים
        </p>
      </div>

      {loadError && <p role="alert" className="text-sm text-danger mb-3">חלק מהנתונים לא נטענו. רעננו את הדף.</p>}

      {thisWeek.length > 0 && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-brand/25 bg-brand-soft px-4 py-3 text-sm text-ink flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold">השבוע</span>
          {memorialsWeek > 0 && <span>{memorialsWeek === 1 ? "יום זיכרון אחד" : `${memorialsWeek} ימי זיכרון`}</span>}
          {eventsWeek > 0 && <span>{eventsWeek === 1 ? "אירוע אחד" : `${eventsWeek} אירועים`}</span>}
          {memorialsWeek > 0 && <span className="text-ink-2">כדאי לוודא שמישהו כבר בקשר עם המשפחות.</span>}
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          {(fallenRes.data ?? []).length === 0 ? (
            <EmptyState
              title="עדיין לא הוזנו חללי היחידה"
              action={perms.manageMemorials(role) ? <LinkButton href="/calendar/fallen" variant="primary" size="sm">לרשימת החללים</LinkButton> : undefined}
            >
              אחרי שמזינים שם ותאריך נפילה, המערכת מחשבת לבד את יום האזכרה העברי ואת יום השנה בכל שנה ומציגה אותם כאן.
            </EmptyState>
          ) : (
            <EmptyState title={`אין מועדים ב-${days === 365 ? "שנה" : `${days} הימים`} הקרובים`} action={days < 365 ? <LinkButton href="/calendar?range=365" size="sm">הצגת השנה הקרובה</LinkButton> : undefined}>
              {canManageEvents ? "אפשר להוסיף אירוע קהילה בכפתור \"הוספת אירוע\"." : "ימי אזכרה ואירועים חדשים יופיעו כאן."}
            </EmptyState>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {months.map((g) => (
            <section key={g.key} aria-labelledby={`m-${g.key}`}>
              <h2 id={`m-${g.key}`} className="text-[13px] font-semibold text-ink-2 mb-2 px-1">{g.label}</h2>
              <Card>
                <ol className="divide-y divide-line">
                  {g.items.map((it) => {
                    const n = daysFromToday(it.date);
                    const isToday = n === 0;
                    const inWeek = it.date <= weekEnd;
                    return (
                      <li
                        key={it.kind === "event" ? `e-${it.event.id}` : `m-${it.fallen.id}-${it.date}`}
                        className={cx("flex gap-4 px-4 sm:px-5 py-4", isToday && "bg-brand-soft/60")}
                      >
                        <DateBlock date={it.date} hebrew={it.hebrew} today={isToday} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {isToday ? <Badge tone="brand">היום</Badge> : inWeek ? <Badge tone="info">השבוע · {relativeDay(it.date)}</Badge> : <span className="text-[12px] text-ink-3">{relativeDay(it.date)}</span>}
                          </div>
                          {it.kind === "memorial" ? (
                            <MemorialItem it={it} family={familyBy.get(it.fallen.id) ?? []} seeFamily={seeFamily} lookups={lookups} />
                          ) : (
                            <EventItem
                              e={it.event}
                              lookups={lookups}
                              canEdit={canManageEvents && (it.event.created_by === userId || role === "admin")}
                                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function DateBlock({ date, hebrew, today }: { date: string; hebrew: string; today: boolean }) {
  return (
    <div className="w-16 sm:w-20 shrink-0 text-center">
      <div className={cx("rounded-lg border px-1 py-1.5", today ? "border-brand bg-brand text-white" : "border-line bg-canvas")}>
        <div className={cx("text-[11px]", today ? "text-white/90" : "text-ink-3")}>{weekdayShort(date)}</div>
        <div className="text-xl font-semibold leading-tight tabular-nums">{Number(date.slice(8, 10))}</div>
        <div className={cx("text-[11px]", today ? "text-white/90" : "text-ink-3")}>{formatDate(date, { day: undefined, year: undefined, month: "short" })}</div>
      </div>
      <div className="text-[11px] text-ink-3 mt-1 leading-snug">{hebrew}</div>
    </div>
  );
}

type L = Awaited<ReturnType<typeof getLookups>>;

function MemorialItem({ it, family, seeFamily, lookups }: {
  it: Extract<Item, { kind: "memorial" }>; family: FamilyRow[]; seeFamily: boolean; lookups: L;
}) {
  const f = it.fallen;
  const name = `${f.first_name} ${f.last_name}`;
  const label = it.azkara && it.anniversary ? "יום האזכרה ויום השנה" : it.azkara ? "יום האזכרה" : "יום השנה (לפי הלוח הלועזי)";
  return (
    <>
      <p className="text-[12px] font-medium text-ink-2 flex items-center gap-1.5">
        <Flame className="size-3.5 text-warn" aria-hidden />{label}
      </p>
      <h3 className="text-[15px] font-semibold text-ink mt-0.5 flex flex-wrap items-center gap-2">
        <Link href={`/calendar/fallen/${f.id}`} className="hover:text-brand hover:underline">{name} ז״ל</Link>
        <Badge>{it.years === 1 ? "שנה אחת" : `${it.years} שנים`}</Badge>
        {f.is_demo && <DemoTag />}
      </h3>
      <dl className="mt-1.5 text-[13px] text-ink-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {f.cohort_id && (<><dt className="text-ink-3">מחזור</dt><dd>{lookups.cohortLabel(f.cohort_id)}</dd></>)}
        <dt className="text-ink-3">אחראי/ת</dt>
        <dd>{f.owner_id ? lookups.staffName(f.owner_id) : <span className="text-warn">אין אחראי/ת — כדאי לקבוע</span>}</dd>
        {seeFamily && (
          <>
            <dt className="text-ink-3">משפחה</dt>
            <dd>
              {family.length === 0 ? (
                <span className="text-ink-3">לא מוצגים בני משפחה. <Link href={`/calendar/fallen/${f.id}`} className="text-brand hover:underline">לקישור בני משפחה</Link></span>
              ) : (
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {family.map((m) => (
                    <li key={m.contact_id}>
                      <Link href={`/contacts/${m.contact_id}`} className="text-ink hover:text-brand hover:underline">{m.contacts!.full_name}</Link>
                      {m.relation && <span className="text-ink-3"> ({m.relation})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
      </dl>
      <div className="mt-3">
        <MemorialTaskButton fallenId={f.id} occasion={it.azkara ? "azkara" : "anniversary"} name={name} />
      </div>
    </>
  );
}

function EventItem({ e, lookups, canEdit }: { e: EventRow; lookups: L; canEdit: boolean }) {
  const targeted = e.cohort_id || e.region_id;
  const invitees = new URLSearchParams();
  if (e.cohort_id) invitees.set("cohort", String(e.cohort_id));
  if (e.region_id) invitees.set("region", String(e.region_id));
  return (
    <>
      <p className="text-[12px] font-medium text-ink-2 flex items-center gap-1.5">
        <CalendarDays className="size-3.5 text-info" aria-hidden />אירוע קהילה
      </p>
      <h3 className="text-[15px] font-semibold text-ink mt-0.5 flex flex-wrap items-center gap-2">
        {e.title}
        {e.is_demo && <DemoTag />}
      </h3>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
        <span className="inline-flex items-center gap-1"><Clock className="size-3.5 text-ink-3" aria-hidden />{ilTime(e.starts_at)}</span>
        {e.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-ink-3" aria-hidden />{e.location}</span>}
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5 text-ink-3" aria-hidden />
          {targeted ? [e.cohort_id && `מחזור ${lookups.cohortLabel(e.cohort_id)}`, e.region_id && `אזור ${lookups.regionLabel(e.region_id)}`].filter(Boolean).join(" · ") : "לכל הקהילה"}
        </span>
      </div>
      {e.description && <p className="text-sm text-ink-2 mt-2 whitespace-pre-line line-clamp-3">{e.description}</p>}
      {(canEdit || targeted) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {targeted && (
            <LinkButton href={`/contacts?${invitees}`} size="sm" variant="secondary"><Users className="size-4" aria-hidden />רשימת מוזמנים</LinkButton>
          )}
          {canEdit && (
            <EditEventDialog
              event={{ id: e.id, title: e.title, date: ilDate(e.starts_at), time: ilTime(e.starts_at), location: e.location, cohort_id: e.cohort_id, region_id: e.region_id, description: e.description }}
              cohorts={lookups.cohorts}
              regions={lookups.regions}
            />
          )}
          {canEdit && (
            <form action={deleteEvent}>
              <input type="hidden" name="id" value={e.id} />
              <ConfirmSubmit message={`למחוק את האירוע "${e.title}"? אי אפשר לבטל.`} variant="secondary">מחיקה<span className="sr-only"> של {e.title}</span></ConfirmSubmit>
            </form>
          )}
        </div>
      )}
    </>
  );
}

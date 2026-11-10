import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, PhoneCall, CheckSquare, Users } from "lucide-react";
import { Badge, Card, CardHeader, DemoTag, EmptyState, Stat, cx } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { CareBadge } from "@/components/contacts/status";
import { LogInteractionForm } from "@/components/contacts/log-interaction-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { ATTENTION_FILTER } from "@/lib/alerts";
import { createClient } from "@/lib/supabase/server";
import { addDays, daysText, daysFromToday, formatDate, hebrewDate, memorialDates, relativeDay, todayIL } from "@/lib/dates";
import { CASE_KIND_LABELS } from "@/lib/labels";
import type { CaseAlert, Fallen, OrgEvent, Task } from "@/lib/types";
import { setTaskStatus } from "./contacts/actions";

export const metadata: Metadata = { title: "היום שלי" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Jerusalem" }).format(new Date()));
  return h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : "ערב טוב";
}

type DueCall = { contact_id: string; status_code: string; next_contact_at: string; contacts: { full_name: string; first_name: string; is_demo: boolean } };
type AlertRow = CaseAlert & { cases: { message: string | null; source: string; requester_name: string | null; subject_name: string | null; contacts: { full_name: string } | null } | null };

export default async function HomePage() {
  const { staff, userId } = await requireStaff();
  const role = staff.role;
  const lookups = await getLookups();
  const supabase = await createClient();
  const today = todayIL();
  const in14 = addDays(today, 14);
  const seeCare = perms.seeCare(role);
  const seeCases = perms.seeCases(role);
  const manager = perms.seeAllCases(role);

  const [alertsRes, callsRes, tasksRes, myCasesRes, fallenRes, eventsRes, snapshot] = await Promise.all([
    seeCases ? loadAlerts() : Promise.resolve({ data: [] as AlertRow[], count: 0 }),
    seeCare
      ? supabase.from("contact_care")
          .select("contact_id,status_code,next_contact_at,contacts!inner(full_name,first_name,is_demo,owner_id,archived_at)", { count: "exact" })
          .lte("next_contact_at", today).eq("contacts.owner_id", userId).is("contacts.archived_at", null)
          .or(`snooze_until.is.null,snooze_until.lte.${today}`)
          .order("next_contact_at").limit(30)
      : Promise.resolve({ data: [], count: 0 }),
    supabase.from("tasks").select("*, contacts(full_name)", { count: "exact" }).eq("assignee_id", userId).eq("status", "open")
      .or(`due_date.lte.${today},due_date.is.null`).order("due_date", { nullsFirst: false }).limit(8),
    seeCases
      ? supabase.from("cases").select("id", { count: "exact", head: true }).eq("assignee_id", userId).neq("status", "resolved")
      : Promise.resolve({ count: 0 }),
    supabase.from("fallen").select("*").returns<Fallen[]>(),
    supabase.from("events").select("*").gte("starts_at", today).lte("starts_at", in14 + "T23:59:59").order("starts_at").returns<OrgEvent[]>(),
    manager ? loadSnapshot(today) : Promise.resolve(null),
  ]);

  const alerts = alertsRes.data;
  const calls = ((callsRes.data ?? []) as unknown as DueCall[])
    .sort((a, b) => (lookups.status(b.status_code)?.severity ?? 0) - (lookups.status(a.status_code)?.severity ?? 0) || a.next_contact_at.localeCompare(b.next_contact_at));
  const callsTotal = ("count" in callsRes ? callsRes.count : 0) ?? 0;
  const tasks = (tasksRes.data ?? []) as (Task & { contacts: { full_name: string } | null })[];
  const alertsTotal = alertsRes.count;
  const tasksTotal = tasksRes.count ?? tasks.length;

  // for memorial days in the next two weeks: how many people from the same cohort / town can be called
  const soonFallen = (fallenRes.data ?? []).filter((f) => memorialDates(f.death_date, f.after_sunset, today).nextAzkara <= in14).map((f) => f.id);
  const { data: soonLinks } = soonFallen.length
    ? await supabase.from("fallen_connections").select("fallen_id, reason").in("fallen_id", soonFallen).limit(20000)
    : { data: [] };
  const linkCount = new Map<string, { cohort: number; city: number }>();
  for (const l of (soonLinks ?? []) as { fallen_id: string; reason: "cohort" | "city" }[]) {
    const c = linkCount.get(l.fallen_id) ?? { cohort: 0, city: 0 };
    c[l.reason]++;
    linkCount.set(l.fallen_id, c);
  }
  const linkSub = (id: string) => {
    const c = linkCount.get(id);
    if (!c) return "";
    return [c.cohort && `${c.cohort} מאותו מחזור`, c.city && `${c.city} מאותו יישוב`].filter(Boolean).join(", ");
  };

  const upcoming = [
    ...(fallenRes.data ?? []).flatMap((f) => {
      const m = memorialDates(f.death_date, f.after_sunset, today);
      const out: { date: string; title: string; sub: string; href: string; demo: boolean }[] = [];
      if (m.nextAzkara <= in14) out.push({ date: m.nextAzkara, title: `יום האזכרה ל${f.first_name} ${f.last_name} ז״ל`, sub: [`${m.azkaraHebrew} · ${m.years} שנים`, f.residence, linkSub(f.id) && `לפנות אל: ${linkSub(f.id)}`].filter(Boolean).join(" · "), href: `/calendar/fallen/${f.id}`, demo: f.is_demo });
      if (m.nextAnniversary <= in14 && m.nextAnniversary !== m.nextAzkara) out.push({ date: m.nextAnniversary, title: `יום השנה לנפילת ${f.first_name} ${f.last_name} ז״ל`, sub: "לפי התאריך הלועזי", href: `/calendar/fallen/${f.id}`, demo: f.is_demo });
      return out;
    }),
    ...(eventsRes.data ?? []).map((e) => ({ date: e.starts_at.slice(0, 10), title: e.title, sub: e.location ?? "", href: "/calendar", demo: e.is_demo })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const nothingUrgent = alerts.length === 0 && calls.length === 0 && tasks.length === 0;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}, {staff.full_name.split(" ")[0]}</h1>
        <p className="text-sm text-ink-2 mt-1">
          {formatDate(today, { weekday: "long", day: "numeric", month: "long" })} · {hebrewDate(today)}
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {seeCases && <Stat label="דורש טיפול" value={alertsTotal} tone={alertsTotal ? "danger" : "neutral"} href="/cases" hint="פניות וחששות פתוחים" />}
        {seeCare && <Stat label="שיחות שהגיע זמנן" value={callsTotal} tone={callsTotal ? "warn" : "neutral"} href="/follow-up" hint="של אנשים באחריותי" />}
        <Stat label="משימות להיום" value={tasksTotal} href="/follow-up?tab=tasks" hint="כולל משימות באיחור" />
        {seeCases && <Stat label="פניות אצלי" value={myCasesRes.count ?? 0} href="/cases?tab=mine" />}
      </div>

      {nothingUrgent && (
        <Card className="mb-6">
          <EmptyState title="אין כרגע משהו דחוף">אין התראות, שיחות או משימות שממתינות לך. זה זמן טוב לעבור על <Link href="/contacts?owner=me" className="text-brand underline">האנשים שבאחריותך</Link>.</EmptyState>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {seeCases && alerts.length > 0 && (
          <Card className="border-danger/30 lg:col-span-2">
            <CardHeader title={<span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-danger" aria-hidden />דורש טיפול</span>}
              subtitle={alertsTotal > alerts.length ? `מוצגות ${alerts.length} מתוך ${alertsTotal}` : undefined}
              action={<Link href="/cases" className="text-sm text-brand hover:underline">כל הפניות</Link>} />
            <ul className="divide-y divide-line border-t border-line">
              {alerts.map((a) => {
                const who = a.cases?.contacts?.full_name ?? a.cases?.subject_name ?? a.cases?.requester_name ?? "לא ידוע";
                const lateDays = -daysFromToday(a.due_at.slice(0, 10));
                const reasons = [
                  a.kind === "concern" && "דיווח חשש",
                  a.cases?.source === "talk_form" && "ביקש/ה לדבר",
                  a.priority === "urgent" && a.cases?.source !== "talk_form" && "דחופה",
                  a.unassigned && "ללא אחראי",
                  a.overdue && (lateDays > 0 ? `באיחור של ${daysText(lateDays)}` : "עבר מועד הטיפול"),
                  a.stalled && "אין פעילות שבוע",
                ].filter(Boolean) as string[];
                return (
                  <li key={a.id}>
                    <Link href={`/cases/${a.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-canvas">
                      <span className="text-sm font-medium">{CASE_KIND_LABELS[a.kind]} #{a.ref_no} · {who}</span>
                      <span className="flex flex-wrap gap-1">{reasons.map((r) => <Badge key={r} tone="danger">{r}</Badge>)}</span>
                      <span className="text-[12px] text-ink-3 ms-auto">{a.assignee_id ? lookups.staffName(a.assignee_id) : ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {seeCare && (
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><PhoneCall className="size-4 text-brand" aria-hidden />שיחות ״מה נשמע״</span>}
              subtitle={callsTotal > calls.length ? `${calls.length} מתוך ${callsTotal}, הדחופים קודם` : undefined}
              action={<Link href="/follow-up" className="text-sm text-brand hover:underline">לכל השיחות</Link>} />
            {calls.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-3">אין שיחות שממתינות לך היום.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {calls.slice(0, 6).map((c) => {
                  const late = -daysFromToday(c.next_contact_at);
                  return (
                    <li key={c.contact_id} className="px-5 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <Link href={`/contacts/${c.contact_id}`} className="text-sm font-medium hover:underline">{c.contacts.full_name}</Link>
                        {c.contacts.is_demo && <span className="ms-2"><DemoTag /></span>}
                        <div className="flex items-center gap-2 mt-0.5">
                          <CareBadge status={lookups.status(c.status_code)} />
                          <span className={cx("text-[12px]", late > 0 ? "text-danger" : "text-ink-3")}>{late > 0 ? `באיחור של ${daysText(late)}` : "היום"}</span>
                        </div>
                      </div>
                      <Modal trigger="תיעוד" title={`איך היה עם ${c.contacts.first_name}?`} triggerVariant="secondary" triggerSize="sm">
                        <LogInteractionForm contactId={c.contact_id} />
                      </Modal>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><CheckSquare className="size-4 text-brand" aria-hidden />משימות להיום ובאיחור</span>}
            action={<Link href="/follow-up?tab=tasks" className="text-sm text-brand hover:underline">כל המשימות</Link>} />
          {tasks.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-3">אין משימות פתוחות להיום.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {tasks.map((t) => (
                <li key={t.id} className="px-5 py-2.5 flex items-center gap-3">
                  <form action={setTaskStatus}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value="done" />
                    <button className="size-6 rounded border-2 border-control hover:border-brand" aria-label={`סימון "${t.title}" כבוצע`} />
                  </form>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{t.title}</p>
                    <p className="text-[12px] text-ink-3">
                      {t.contacts && t.contact_id && <Link href={`/contacts/${t.contact_id}`} className="hover:underline">{t.contacts.full_name}</Link>}
                      {t.due_date && <span className={cx(daysFromToday(t.due_date) < 0 && "text-danger")}>{t.contacts ? " · " : ""}{relativeDay(t.due_date)}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-brand" aria-hidden />בשבועיים הקרובים</span>}
            action={<Link href="/calendar" className="text-sm text-brand hover:underline">לוח השנה</Link>} />
          {upcoming.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-3">אין ימי אזכרה או אירועים בשבועיים הקרובים.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {upcoming.map((u, i) => (
                <li key={i}>
                  <Link href={u.href} className="flex items-center gap-4 px-5 py-2.5 hover:bg-canvas">
                    <div className="w-12 text-center shrink-0">
                      <div className="text-lg font-semibold leading-none tabular-nums">{Number(u.date.slice(8, 10))}</div>
                      <div className="text-[11px] text-ink-3">{formatDate(u.date, { day: undefined, year: undefined, month: "short" })}</div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{u.title} {u.demo && <DemoTag />}</p>
                      <p className="text-[12px] text-ink-3">{relativeDay(u.date)}{u.sub ? ` · ${u.sub}` : ""}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {snapshot && (
          <Card className="lg:col-span-2">
            <CardHeader title={<span className="inline-flex items-center gap-2"><Users className="size-4 text-brand" aria-hidden />תמונת מצב של העמותה</span>}
              action={perms.reports(role) ? <Link href="/reports" className="text-sm text-brand hover:underline">לדוחות</Link> : undefined} />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-5 pb-5">
              <Stat label="אנשים בקהילה" value={snapshot.total.toLocaleString("he-IL")} href="/contacts" />
              <Stat label="בקשר ב-6 החודשים האחרונים" value={snapshot.total ? `${Math.round((snapshot.inTouch / snapshot.total) * 100)}%` : "—"} hint={`${snapshot.inTouch.toLocaleString("he-IL")} אנשים`} />
              <Stat label="שיחות שממתינות (כולם)" value={snapshot.dueAll.toLocaleString("he-IL")} href="/follow-up?whose=all" tone={snapshot.dueAll ? "warn" : "neutral"} />
              <Stat label="ללא אחראי/ת" value={snapshot.noOwner.toLocaleString("he-IL")} href="/follow-up?tab=unowned" tone={snapshot.noOwner ? "warn" : "neutral"} />
              <Stat label="פרטים לא אומתו מעל שנה" value={snapshot.stale.toLocaleString("he-IL")} href="/contacts?health=not_verified" />
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

async function loadAlerts(): Promise<{ data: AlertRow[]; count: number }> {
  const supabase = await createClient();
  const { data, count } = await supabase.from("case_alerts").select("*", { count: "exact" })
    .neq("status", "resolved").or(ATTENTION_FILTER).order("due_at").limit(8).returns<CaseAlert[]>();
  const list = data ?? [];
  if (!list.length) return { data: [], count: count ?? 0 };
  const { data: details } = await supabase.from("cases")
    .select("id, message, source, requester_name, subject_name, contacts:contacts!cases_contact_id_fkey(full_name)")
    .in("id", list.map((a) => a.id));
  const byId = new Map((details ?? []).map((d) => [d.id as string, d]));
  return { data: list.map((a) => ({ ...a, cases: (byId.get(a.id) as unknown as AlertRow["cases"]) ?? null })), count: count ?? list.length };
}

async function loadSnapshot(today: string) {
  const supabase = await createClient();
  const sixMonths = addDays(today, -182);
  const year = addDays(today, -365);
  const base = () => supabase.from("contacts").select("id", { count: "exact", head: true }).is("archived_at", null).is("merged_into", null);
  const [total, inTouch, dueAll, noOwner, stale] = await Promise.all([
    base(),
    supabase.from("contact_care").select("contact_id", { count: "exact", head: true }).gte("last_contact_at", sixMonths),
    supabase.from("contact_care").select("contact_id", { count: "exact", head: true }).lte("next_contact_at", today),
    base().is("owner_id", null),
    base().or(`verified_at.is.null,verified_at.lt.${year}`),
  ]);
  return { total: total.count ?? 0, inTouch: inTouch.count ?? 0, dueAll: dueAll.count ?? 0, noOwner: noOwner.count ?? 0, stale: stale.count ?? 0 };
}

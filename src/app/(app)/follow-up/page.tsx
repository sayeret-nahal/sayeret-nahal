import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Phone } from "lucide-react";
import { Card, DemoTag, EmptyState, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { CareBadge } from "@/components/contacts/status";
import { LogInteractionForm } from "@/components/contacts/log-interaction-form";
import { requireStaff } from "@/lib/auth";
import { getLookups, logAccess } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { addDays, daysText, daysFromToday, formatDate, relativeDay, todayIL } from "@/lib/dates";
import { whatsappLink } from "@/lib/phone";
import { PRIORITY_LABELS } from "@/lib/labels";
import type { Task } from "@/lib/types";
import { setTaskStatus } from "../contacts/actions";

export const metadata: Metadata = { title: "שיחות ומשימות" };

type CallRow = {
  contact_id: string; status_code: string; next_contact_at: string; last_contact_at: string | null;
  contacts: { id: string; full_name: string; first_name: string; phone: string | null; cohort_id: number | null; owner_id: string | null; is_demo: boolean };
};

const TABS = [
  { key: "calls", label: "שיחות שהגיע זמנן" },
  { key: "tasks", label: "משימות" },
  { key: "unowned", label: "ללא אחראי" },
] as const;

export default async function FollowUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff, userId } = await requireStaff();
  const role = staff.role;
  const lookups = await getLookups();
  const supabase = await createClient();
  const today = todayIL();
  const seeCare = perms.seeCare(role);
  const tab = (sp.tab as (typeof TABS)[number]["key"]) ?? (seeCare ? "calls" : "tasks");
  const whose = sp.whose ?? "me"; // me | all | <staff id>
  const canSeeAll = perms.seeAllCases(role) || role === "cohort_lead";

  let calls: CallRow[] = [];
  let callsTotal = 0;
  if (tab === "calls" && seeCare) {
    let q = supabase.from("contact_care")
      .select("contact_id,status_code,next_contact_at,last_contact_at,contacts!inner(id,full_name,first_name,phone,cohort_id,owner_id,is_demo,archived_at,merged_into)", { count: "exact" })
      .lte("next_contact_at", sp.horizon === "week" ? addDays(today, 7) : today)
      .is("contacts.archived_at", null).is("contacts.merged_into", null)
      .or(`snooze_until.is.null,snooze_until.lte.${today}`)
      .order("next_contact_at").limit(200);
    if (whose === "me" || !canSeeAll) q = q.eq("contacts.owner_id", userId);
    else if (whose !== "all") q = q.eq("contacts.owner_id", whose);
    if (sp.cohort) q = q.eq("contacts.cohort_id", Number(sp.cohort));
    if (sp.status) q = q.eq("status_code", sp.status);
    const { data, count } = await q;
    calls = (data ?? []) as unknown as CallRow[];
    callsTotal = count ?? calls.length;
    // most urgent first: severity, then how late
    calls.sort((a, b) => (lookups.status(b.status_code)?.severity ?? 0) - (lookups.status(a.status_code)?.severity ?? 0) || a.next_contact_at.localeCompare(b.next_contact_at));
  }

  let tasks: (Task & { contacts: { full_name: string } | null })[] = [];
  if (tab === "tasks") {
    let q = supabase.from("tasks").select("*, contacts(full_name)").eq("status", "open").order("due_date", { nullsFirst: false }).limit(200);
    if (whose === "me" || !perms.seeAllCases(role)) q = q.eq("assignee_id", userId);
    else if (whose !== "all") q = q.eq("assignee_id", whose);
    const { data } = await q;
    tasks = (data ?? []) as typeof tasks;
  }

  let unowned: { id: string; full_name: string; cohort_id: number | null; city: string | null; is_demo: boolean }[] = [];
  let unownedTotal = 0;
  if (tab === "unowned") {
    let q = supabase.from("contacts").select("id,full_name,cohort_id,city,is_demo", { count: "exact" }).is("owner_id", null).is("archived_at", null).is("merged_into", null).order("full_name").limit(100);
    if (sp.cohort) q = q.eq("cohort_id", Number(sp.cohort));
    const { data, count } = await q;
    unowned = data ?? [];
    unownedTotal = count ?? 0;
  }

  await logAccess("view", "follow_up", null, { tab, whose, rows: calls.length + tasks.length + unowned.length });
  const tabHref = (k: string) => `?tab=${k}${whose !== "me" ? `&whose=${whose}` : ""}`;

  return (
    <>
      <PageHeader title="שיחות ומשימות" description="מי מחכה לשיחת ״מה נשמע״, מה צריך לעשות, ומי עדיין בלי אחראי." />

      <nav aria-label="לשוניות" className="flex gap-1 border-b border-line mb-4 overflow-x-auto">
        {TABS.filter((t) => t.key !== "calls" || seeCare).map((t) => (
          <Link key={t.key} href={tabHref(t.key)} aria-current={tab === t.key ? "page" : undefined}
            className={cx("px-4 h-10 inline-flex items-center text-sm border-b-2 -mb-px whitespace-nowrap", tab === t.key ? "border-brand text-brand-strong font-medium" : "border-transparent text-ink-2 hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab !== "unowned" && (
        <AutoSubmitForm className="flex flex-wrap gap-2 mb-4">
          <input type="hidden" name="tab" value={tab} />
          {(canSeeAll || perms.seeAllCases(role)) && (
            <Select name="whose" defaultValue={whose} aria-label="של מי" className="w-auto h-9">
              <option value="me">שלי</option>
              <option value="all">של כולם</option>
              {lookups.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          )}
          {tab === "calls" && (
            <>
              <Select name="horizon" defaultValue={sp.horizon ?? ""} aria-label="טווח" className="w-auto h-9">
                <option value="">עד היום</option>
                <option value="week">כולל השבוע הקרוב</option>
              </Select>
              <Select name="status" defaultValue={sp.status ?? ""} aria-label="מצב" className="w-auto h-9">
                <option value="">כל המצבים</option>
                {lookups.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </Select>
              <Select name="cohort" defaultValue={sp.cohort ?? ""} aria-label="מחזור" className="w-auto h-9">
                <option value="">כל המחזורים</option>
                {lookups.cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </>
          )}
        </AutoSubmitForm>
      )}

      {tab === "calls" && (
        <Card>
          {calls.length === 0 ? (
            <EmptyState title="אין שיחות שממתינות">
              {whose === "me" ? "כל האנשים שבאחריותך קיבלו מענה. כל הכבוד." : "אין שיחות שהגיע זמנן לפי הסינון."}
            </EmptyState>
          ) : (
            <>
              <p className="px-5 pt-4 text-[13px] text-ink-3">{callsTotal > calls.length ? `מוצגים ${calls.length} מתוך ${callsTotal}` : `${callsTotal} שיחות`} · הדחופים קודם</p>
              <ul className="divide-y divide-line mt-2">
                {calls.map((r) => {
                  const late = -daysFromToday(r.next_contact_at);
                  const st = lookups.status(r.status_code);
                  return (
                    <li key={r.contact_id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-48">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/contacts/${r.contacts.id}`} className="font-medium hover:underline">{r.contacts.full_name}</Link>
                          <CareBadge status={st} />
                          {r.contacts.is_demo && <DemoTag />}
                        </div>
                        <p className="text-[12px] text-ink-3 mt-0.5">
                          {lookups.cohortLabel(r.contacts.cohort_id) && <>{lookups.cohortLabel(r.contacts.cohort_id)} · </>}
                          קשר אחרון: {r.last_contact_at ? relativeDay(r.last_contact_at.slice(0, 10)) : "אין תיעוד"}
                          {" · "}<span className={cx(late > 0 && "text-danger")}>{late > 0 ? `באיחור של ${daysText(late)}` : late === 0 ? "היום" : relativeDay(r.next_contact_at)}</span>
                          {whose !== "me" && <> · {lookups.staffName(r.contacts.owner_id)}</>}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {r.contacts.phone && <a href={`tel:${r.contacts.phone}`} className={buttonClass("secondary", "sm")} aria-label={`התקשרות ל${r.contacts.full_name}`}><Phone className="size-4" aria-hidden /></a>}
                        {r.contacts.phone && <a href={whatsappLink(r.contacts.phone)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")} aria-label={`וואטסאפ ל${r.contacts.full_name}`}><MessageCircle className="size-4" aria-hidden /></a>}
                        <Modal trigger="תיעוד" title={`איך היה עם ${r.contacts.first_name}?`} triggerVariant="primary" triggerSize="sm">
                          <LogInteractionForm contactId={r.contact_id} />
                        </Modal>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      )}

      {tab === "tasks" && (
        <Card>
          {tasks.length === 0 ? (
            <EmptyState title="אין משימות פתוחות">משימות נוצרות מכרטיס אדם, מפנייה, או אוטומטית כשמסמנים ״נדרש המשך טיפול״ אחרי שיחה.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((t) => {
                const late = t.due_date ? daysFromToday(t.due_date) < 0 : false;
                return (
                  <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="done" />
                      <button className="size-6 rounded border-2 border-control hover:border-brand grid place-items-center" aria-label={`סימון "${t.title}" כבוצע`} />
                    </form>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{t.title}{t.priority !== "normal" && <span className="text-danger text-[12px] ms-2">{PRIORITY_LABELS[t.priority]}</span>}</p>
                      <p className="text-[12px] text-ink-3">
                        {t.contacts && t.contact_id && <><Link href={`/contacts/${t.contact_id}`} className="hover:underline">{t.contacts.full_name}</Link> · </>}
                        {t.case_id && <><Link href={`/cases/${t.case_id}`} className="hover:underline">פנייה</Link> · </>}
                        {whose !== "me" && <>{lookups.staffName(t.assignee_id)} · </>}
                        {t.due_date ? <span className={cx(late && "text-danger font-medium")}>{late ? `באיחור (${formatDate(t.due_date)})` : relativeDay(t.due_date)}</span> : "ללא תאריך"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "unowned" && (
        <Card>
          {unowned.length === 0 ? (
            <EmptyState title="לכל אחד יש אחראי/ת קשר">מצוין — אף אחד לא נופל בין הכיסאות.</EmptyState>
          ) : (
            <>
              <p className="px-5 pt-4 text-[13px] text-ink-3">{unownedTotal} אנשים ללא אחראי/ת. אפשר לשייך כמה בבת אחת מרשימת האנשים (סימון ← עדכון קבוצתי).</p>
              <ul className="divide-y divide-line mt-2">
                {unowned.map((c) => (
                  <li key={c.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <Link href={`/contacts/${c.id}`} className="text-sm font-medium hover:underline">{c.full_name} {c.is_demo && <DemoTag />}</Link>
                    <span className="text-[12px] text-ink-3">{[lookups.cohortLabel(c.cohort_id), c.city].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
              <div className="px-5 py-3 border-t border-line"><Link href="/contacts?owner=none" className="text-sm text-brand hover:underline">לרשימה המלאה עם עדכון קבוצתי ←</Link></div>
            </>
          )}
        </Card>
      )}
    </>
  );
}


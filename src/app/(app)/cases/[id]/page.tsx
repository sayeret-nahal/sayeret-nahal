import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Clock, Mail, MessageCircle, Phone, UserRound } from "lucide-react";
import { Badge, Card, CardHeader, DemoTag, EmptyState, Notice, PageHeader, buttonClass, cx } from "@/components/ui";
import {
  AddNoteForm, AssignForm, CaseTaskButton, CreateContactButton, LinkContactForm, SuggestedContactLink, ReopenForm, ResolveForm, StatusForm,
} from "@/components/cases/case-forms";
import { KindBadge, PRIORITY_TONE, STATUS_TONE, caseFlags, dueText, isLate, nowMs } from "@/components/cases/flags";
import { requireStaff } from "@/lib/auth";
import { getLookups, logAccess, type Lookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { displayPhone, whatsappLink } from "@/lib/phone";
import { daysFromToday, formatDateTime, relativeDay } from "@/lib/dates";
import { CASE_KIND_LABELS, CASE_SOURCE_LABELS, CASE_STATUS_LABELS, CATEGORY_LABELS, CHANNEL_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import type { Case, CaseAlert, CaseEvent, CaseStatus, Task } from "@/lib/types";
import { setTaskStatus } from "../../contacts/actions";

export const metadata: Metadata = { title: "פנייה" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CaseRow = Case & {
  contacts: { id: string; full_name: string; phone: string | null; is_demo: boolean } | null;
  suggested: { id: string; full_name: string } | null;
  suspected_spam: boolean;
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff, userId } = await requireStaff();
  const role = staff.role;
  if (!perms.seeCases(role)) redirect("/");
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();

  const { data: c } = await supabase.from("cases").select("*, contacts:contacts!cases_contact_id_fkey(id, full_name, phone, is_demo), suggested:contacts!cases_suggested_contact_id_fkey(id, full_name)").eq("id", id).maybeSingle<CaseRow>();
  if (!c) notFound();

  const [lookups, events, alert, tasks] = await Promise.all([
    getLookups(),
    supabase.from("case_events").select("*").eq("case_id", id).order("created_at").returns<CaseEvent[]>(),
    supabase.from("case_alerts").select("unassigned,overdue,stalled,closed_without_action").eq("id", id)
      .maybeSingle<Pick<CaseAlert, "unassigned" | "overdue" | "stalled" | "closed_without_action">>(),
    supabase.from("tasks").select("*").eq("case_id", id).eq("status", "open").order("due_date", { nullsFirst: false }).returns<Task[]>(),
    logAccess("view", "cases", id),
  ]);

  const now = nowMs();
  const log = events.data ?? [];
  const flags = caseFlags(alert.data, c, now);
  const late = isLate(c.due_at, c.status, now);
  const resolved = c.status === "resolved";
  const hasActivity = log.some((e) => e.kind === "note" || e.kind === "call");
  // only people who are allowed to see cases can be assigned
  const staffOptions = lookups.staff.filter((s) => perms.seeCases(s.role)).map((s) => ({ id: s.id, full_name: s.full_name }));
  const contact = c.contacts;
  const title = `${CASE_KIND_LABELS[c.kind]} #${c.ref_no}`;

  return (
    <>
      <PageHeader
        back={{ href: "/cases", label: "פניות" }}
        title={<span className="inline-flex flex-wrap items-center gap-2">{title}{c.is_demo && <DemoTag />}</span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <KindBadge kind={c.kind} />
            <Badge tone={STATUS_TONE[c.status]}>{CASE_STATUS_LABELS[c.status]}</Badge>
            <Badge tone={PRIORITY_TONE[c.priority]}>עדיפות {PRIORITY_LABELS[c.priority]}</Badge>
            <span>נפתחה {formatDateTime(c.opened_at)}</span>
            <span>{CASE_SOURCE_LABELS[c.source] ?? c.source}</span>
            {c.category && <span>{CATEGORY_LABELS[c.category] ?? c.category}</span>}
          </span>
        }
      />

      {/* Deadline strip */}
      <div className={cx(
        "mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-sm",
        resolved ? "border-ok/20 bg-ok-soft" : late ? "border-danger/25 bg-danger-soft" : "border-line bg-surface",
      )}>
        {resolved ? (
          <>
            <CheckCircle2 className="size-4 text-ok" aria-hidden />
            <span>טופלה ונסגרה {c.resolved_at ? formatDateTime(c.resolved_at) : ""}</span>
            {c.resolved_at && <span className="text-ink-3">{Date.parse(c.resolved_at) <= Date.parse(c.due_at) ? "· בזמן" : "· אחרי המועד"}</span>}
          </>
        ) : (
          <>
            <Clock className={cx("size-4", late ? "text-danger" : "text-ink-3")} aria-hidden />
            <span className={cx(late && "text-danger font-medium")}>לטפל עד {formatDateTime(c.due_at)} · {dueText(c.due_at, c.status, now)}</span>
            <span className="text-ink-3">· אחראי/ת: {c.assignee_id ? lookups.staffName(c.assignee_id) || "—" : <span className="text-danger">ללא</span>}</span>
          </>
        )}
      </div>

      {c.suspected_spam && (
        <div className="mb-4">
          <Notice tone="warn" title="ייתכן שזו הצפה">
            הפנייה התקבלה בשעה שבה הגיעו הרבה פניות מהטופס הציבורי. היא לא נחסמה — בדקו אותה כרגיל, אבל ייתכן שמדובר בניסיון להציף את המערכת.
          </Notice>
        </div>
      )}

      {flags.length > 0 && (
        <div className="mb-6">
          <Notice tone={flags.some((f) => f.key === "overdue" || f.key === "unassigned") ? "danger" : "warn"} title="מה דורש תשומת לב">
            <ul className="list-disc ps-5 mt-1 space-y-0.5">
              {flags.map((f) => <li key={f.key}><strong className="font-medium text-ink">{f.label}</strong> — {f.explain}</li>)}
            </ul>
          </Notice>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <WhoCard c={c} canCreate={perms.createContacts(role)} />

          <Card>
            <CardHeader title={c.kind === "concern" ? "מה מדאיג" : "מה ביקשו"} />
            <div className="px-5 pb-5">
              {c.message
                ? <p className="text-sm text-ink whitespace-pre-line leading-relaxed">{c.message}</p>
                : <p className="text-sm text-ink-3">לא נכתב תיאור. {c.source === "talk_form" ? "בטופס הזה התיאור אינו חובה: חשוב רק לחזור לאדם." : ""}</p>}
            </div>
          </Card>

          {resolved && c.resolution && (
            <Card className="border-ok/25">
              <CardHeader title="מה נעשה" subtitle={c.resolved_at ? `נסגרה ${formatDateTime(c.resolved_at)}` : undefined} />
              <p className="px-5 pb-5 text-sm whitespace-pre-line">{c.resolution}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="יומן טיפול" subtitle="כל מה שנעשה בפנייה, לפי סדר הזמן" />
            {log.length === 0 ? (
              <EmptyState title="עדיין אין תיעוד">כל הערה, שיחה, שינוי אחריות או סטטוס יופיעו כאן.</EmptyState>
            ) : (
              <ol className="border-t border-line px-5 py-4 space-y-4">
                {log.map((e) => <EventItem key={e.id} e={e} source={c.source} lookups={lookups} />)}
              </ol>
            )}
            {!resolved && (
              <div className="border-t border-line px-5 py-4 bg-canvas/50 rounded-b-[var(--radius-card)]">
                <AddNoteForm caseId={c.id} />
              </div>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader title={resolved ? "הפנייה סגורה" : "טיפול"} />
            <div className="px-5 pb-5 flex flex-col gap-4">
              {resolved ? (
                <>
                  <p className="text-sm text-ink-2">אם התברר שצריך להמשיך לטפל, אפשר לפתוח אותה מחדש. היא תחזור לרשימת הפתוחות.</p>
                  <ReopenForm caseId={c.id} />
                </>
              ) : (
                <>
                  <AssignForm key={`a-${c.assignee_id}`} caseId={c.id} assigneeId={c.assignee_id} staff={staffOptions} currentUserId={userId} />
                  <StatusForm key={`s-${c.status}`} caseId={c.id} status={c.status as Exclude<CaseStatus, "resolved">} />
                  <div className="border-t border-line pt-4">
                    <h3 className="text-sm font-semibold mb-2">סגירת הפנייה</h3>
                    <ResolveForm caseId={c.id} hasActivity={hasActivity} />
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="משימות" action={<CaseTaskButton caseId={c.id} contactId={c.contact_id} staff={staffOptions} currentUserId={userId} />} />
            {(tasks.data ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-3">אין משימות פתוחות. משימה עוזרת לזכור צעד הבא עם תאריך, למשל &quot;לחזור אליו ביום חמישי&quot;.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {(tasks.data ?? []).map((t) => (
                  <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-[12px] text-ink-3">
                        {lookups.staffName(t.assignee_id) || "—"}
                        {t.due_date && <> · <span className={cx(daysFromToday(t.due_date) < 0 && "text-danger")}>{relativeDay(t.due_date)}</span></>}
                      </p>
                    </div>
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="done" />
                      <button className={buttonClass("secondary", "sm")} aria-label={`סימון "${t.title}" כבוצע`}>בוצע</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {contact && (
            <Link href={`/contacts/${contact.id}`} className="text-[13px] text-brand hover:underline text-center">
              לכל ההיסטוריה של {contact.full_name} ←
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}

// ---------- "who" box ----------

function ContactLinks({ phone, name }: { phone: string | null; name?: string }) {
  if (!phone) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      <a href={`tel:${phone}`} className={buttonClass("secondary", "sm")} aria-label={name ? `התקשרות ל${name}` : "התקשרות"}>
        <Phone className="size-3.5" aria-hidden /><span dir="ltr">{displayPhone(phone)}</span>
      </a>
      <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
        <MessageCircle className="size-3.5" aria-hidden />וואטסאפ
      </a>
    </div>
  );
}

function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/);
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
}

function WhoCard({ c, canCreate }: { c: CaseRow; canCreate: boolean }) {
  const contact = c.contacts;
  const isConcern = c.kind === "concern";
  // concern forms store "name · cohort · phone" in subject_name
  const subjectParts = (c.subject_name ?? "").split(" · ").map((s) => s.trim()).filter(Boolean);
  const subjectName = subjectParts[0] ?? "";
  const subjectPhone = subjectParts.find((p) => /^\+\d{8,15}$/.test(p)) ?? null;
  const subjectExtra = subjectParts.slice(1).filter((p) => p !== subjectPhone);

  const defaults = isConcern
    ? { ...splitName(subjectName), phone: displayPhone(subjectPhone) }
    : { ...splitName(c.requester_name ?? ""), phone: displayPhone(c.requester_phone) };

  const requester = (c.requester_name || c.requester_phone || c.requester_email) && (
    <div>
      <p className="text-[12px] font-medium text-ink-3 mb-1">{isConcern ? "מי דיווח/ה" : contact ? "פרטים שנמסרו בפנייה" : "מי פנה"}</p>
      {c.requester_name && <p className="text-sm font-medium">{c.requester_name}</p>}
      {c.requester_email && (
        <a href={`mailto:${c.requester_email}`} className="text-sm text-brand hover:underline inline-flex items-center gap-1 mt-1" dir="ltr">
          <Mail className="size-3.5" aria-hidden />{c.requester_email}
        </a>
      )}
      <ContactLinks phone={c.requester_phone} name={c.requester_name ?? undefined} />
      {(c.preferred_channel || c.preferred_time) && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {c.preferred_channel && (<><dt className="text-ink-3">איך לחזור</dt><dd className="font-medium">{CHANNEL_LABELS[c.preferred_channel] ?? c.preferred_channel}</dd></>)}
          {c.preferred_time && (<><dt className="text-ink-3">מתי נוח</dt><dd>{c.preferred_time}</dd></>)}
        </dl>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader title={isConcern ? "על מי מדובר" : "מי"} />
      <div className="px-5 pb-5 flex flex-col gap-4">
        {contact ? (
          <div className="flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-brand shrink-0" aria-hidden><UserRound className="size-4" /></span>
            <div className="min-w-0">
              <Link href={`/contacts/${contact.id}`} className="font-medium text-ink hover:text-brand hover:underline">{contact.full_name}</Link>
              {contact.is_demo && <span className="ms-2"><DemoTag /></span>}
              <p className="text-[12px] text-ink-3">כרטיס אדם במערכת</p>
              <ContactLinks phone={contact.phone} name={contact.full_name} />
            </div>
          </div>
        ) : c.contact_id ? (
          <p className="text-sm text-ink-2">הפנייה מקושרת לכרטיס אדם שאין לך הרשאה לראות.</p>
        ) : isConcern && subjectName ? (
          <div>
            <p className="text-sm font-medium">{subjectName}</p>
            {subjectExtra.length > 0 && <p className="text-[13px] text-ink-2">{subjectExtra.join(" · ")}</p>}
            <ContactLinks phone={subjectPhone} name={subjectName} />
          </div>
        ) : null}

        {requester && <div className={cx((contact || c.contact_id || (isConcern && subjectName)) && "border-t border-line pt-4")}>{requester}</div>}

        {!c.contact_id && (
          <div className="border-t border-line pt-4 flex flex-col gap-3">
            <p className="text-[13px] text-ink-2">
              הפנייה עדיין לא מקושרת לכרטיס אדם. קישור שומר את ההיסטוריה במקום אחד{isConcern ? " ומאפשר לעקוב אחרי האדם לאורך זמן" : ""}.
            </p>
            {c.suggested && <SuggestedContactLink caseId={c.id} contactId={c.suggested.id} name={c.suggested.full_name} />}
            <LinkContactForm caseId={c.id} />
            {canCreate && (defaults.first_name || defaults.phone) && (
              <div><CreateContactButton caseId={c.id} defaults={defaults} /></div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- activity log ----------

function EventItem({ e, source, lookups }: { e: CaseEvent; source: string; lookups: Lookups }) {
  const who = e.staff_id ? lookups.staffName(e.staff_id) || "איש/אשת צוות" : null;
  let title: string;
  let body: string | null = null;
  let tone = "bg-ink-3";
  switch (e.kind) {
    case "created":
      title = source === "talk_form" ? "התקבלה מהטופס \"אני צריך/ה לדבר\""
        : source === "concern_form" ? "התקבלה מהטופס \"מודאג/ת לגבי חבר\"" : "הפנייה נפתחה";
      tone = "bg-brand";
      break;
    case "note":
      title = "הערה"; body = e.body; tone = "bg-info";
      break;
    case "call":
      title = "שיחה"; body = e.body; tone = "bg-info";
      break;
    case "assign":
      title = e.body === "ללא אחראי" ? "האחריות הוסרה" : `הועברה לאחריות ${e.body ?? ""}`.trim();
      break;
    case "status":
      title = `סטטוס: ${CASE_STATUS_LABELS[e.body as CaseStatus] ?? e.body ?? ""}`;
      break;
    case "resolved":
      title = "נסגרה"; body = e.body; tone = "bg-ok";
      break;
    case "reopened":
      title = "נפתחה מחדש"; tone = "bg-warn";
      break;
    default:
      title = e.kind;
  }
  return (
    <li className="relative ps-5">
      <span aria-hidden className={cx("absolute start-0 top-1.5 size-2 rounded-full", tone)} />
      <p className="text-sm"><span className="font-medium">{title}</span></p>
      {body && <p className="text-sm text-ink-2 mt-0.5 whitespace-pre-line">{body}</p>}
      <p className="text-[12px] text-ink-3 mt-0.5">{formatDateTime(e.created_at)}{who ? ` · ${who}` : ""}</p>
    </li>
  );
}

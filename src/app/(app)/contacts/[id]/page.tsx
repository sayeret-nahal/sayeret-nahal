import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Mail, MessageCircle, Phone } from "lucide-react";
import { Badge, Card, CardHeader, DemoTag, EmptyState, LinkButton, Notice, PageHeader, buttonClass, cx } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { CareBadge, TypeChips } from "@/components/contacts/status";
import { LogInteractionForm } from "@/components/contacts/log-interaction-form";
import { TaskForm } from "@/components/contacts/task-form";
import { UpdateLinkButton } from "@/components/contacts/update-link-button";
import { CareForm } from "@/components/contacts/care-form";
import { requireStaff } from "@/lib/auth";
import { getLookups, logAccess } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { displayPhone, whatsappLink } from "@/lib/phone";
import { formatDate, formatDateTime, memorialDates, relativeDay, daysFromToday } from "@/lib/dates";
import { CASE_KIND_LABELS, CASE_STATUS_LABELS, KIND_LABELS, OUTCOME_LABELS, SOURCE_LABELS } from "@/lib/labels";
import type { Case, Contact, ContactCare, ContactHealth, Donation, Fallen, Interaction, Task } from "@/lib/types";
import { activePayerCutoff, pinkState } from "@/lib/pink";
import { markPhone, markVerified, setTaskStatus, archiveContact } from "../actions";

export const metadata: Metadata = { title: "כרטיס אדם" };

type TimelineItem = { at: string; kind: "interaction" | "case" | "donation"; node: React.ReactNode };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff, userId } = await requireStaff();
  const role = staff.role;
  const supabase = await createClient();

  const { data: c } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle<Contact>();
  if (!c) notFound();
  if (c.merged_into) redirect(`/contacts/${c.merged_into}`);

  const [lookups, links, care, interactions, cases, tasks, donations, family, health] = await Promise.all([
    getLookups(),
    supabase.from("contact_type_links").select("type_code").eq("contact_id", id),
    perms.seeCare(role) ? supabase.from("contact_care").select("*").eq("contact_id", id).maybeSingle<ContactCare>() : Promise.resolve({ data: null }),
    supabase.from("interactions").select("*").eq("contact_id", id).order("occurred_at", { ascending: false }).limit(100).returns<Interaction[]>(),
    perms.seeCases(role) ? supabase.from("cases").select("*").eq("contact_id", id).order("opened_at", { ascending: false }).returns<Case[]>() : Promise.resolve({ data: [] as Case[] }),
    supabase.from("tasks").select("*").eq("contact_id", id).eq("status", "open").order("due_date", { nullsFirst: false }).returns<Task[]>(),
    perms.manageDonors(role) ? supabase.from("donations").select("*").eq("contact_id", id).order("donated_at", { ascending: false }).returns<Donation[]>() : Promise.resolve({ data: [] as Donation[] }),
    perms.seeCare(role) ? supabase.from("fallen_family").select("relation, fallen(*)").eq("contact_id", id) : Promise.resolve({ data: [] }),
    supabase.from("contact_health").select("*").eq("contact_id", id).maybeSingle<ContactHealth>(),
    logAccess("view", "contacts", id),
  ]);

  const typeCodes = (links.data ?? []).map((l) => l.type_code as string);
  const payerCutoff = await activePayerCutoff(supabase);
  const pink = pinkState(typeCodes, c.last_paid_at, payerCutoff);
  const isMember = typeCodes.includes("member");
  const activeMember = isMember && !!c.last_paid_at && c.last_paid_at >= payerCutoff;
  const { data: benefitRows } = await supabase.from("benefit_usages").select("id, provider, used_at, description, amount")
    .eq("contact_id", id).order("used_at", { ascending: false }).limit(20);
  const benefits = (benefitRows ?? []) as { id: string; provider: string; used_at: string; description: string | null; amount: number | null }[];
  const careRow = care.data;
  const status = lookups.status(careRow?.status_code);
  const h = health.data;
  const openCases = (cases.data ?? []).filter((x) => x.status !== "resolved");
  const fallen = ((family.data ?? []) as unknown as { relation: string | null; fallen: Fallen }[]).filter((f) => f.fallen);

  // fallen of the unit this person is connected to: same cohort, or the fallen soldier lived in their town
  const { data: fLinks } = perms.seeCare(role)
    ? await supabase.from("fallen_connections").select("fallen_id, reason").eq("contact_id", id)
    : { data: [] };
  const fReasons = new Map<string, Set<string>>();
  for (const l of (fLinks ?? []) as { fallen_id: string; reason: string }[]) {
    if (!fReasons.has(l.fallen_id)) fReasons.set(l.fallen_id, new Set());
    fReasons.get(l.fallen_id)!.add(l.reason);
  }
  const { data: fRows } = fReasons.size
    ? await supabase.from("fallen").select("*").in("id", [...fReasons.keys()]).returns<Fallen[]>()
    : { data: [] as Fallen[] };
  const connectedFallen = (fRows ?? [])
    .map((f) => ({ f, reasons: fReasons.get(f.id)!, m: memorialDates(f.death_date, f.after_sunset) }))
    .sort((a, b) => (a.m.nextAzkara < b.m.nextAzkara ? -1 : 1));

  const warnings: { text: string; action?: React.ReactNode }[] = [];
  if (h?.unreachable) warnings.push({ text: "שלושה ניסיונות אחרונים ללא מענה. אולי המספר השתנה?" });
  if (c.phone_status === "invalid") warnings.push({ text: "מספר הטלפון סומן כלא תקין." });
  if (!c.phone && !c.email) warnings.push({ text: "אין דרך ליצור קשר: חסרים טלפון ודוא״ל." });
  if (h?.not_verified) warnings.push({
    text: c.verified_at ? `הפרטים אומתו לאחרונה לפני ${relativeDay(c.verified_at.slice(0, 10)).replace("לפני ", "")}.` : "הפרטים מעולם לא אומתו מול האדם.",
  });
  if (!c.owner_id) warnings.push({ text: "אין אחראי/ת קשר. מי ישמור על הקשר?" });

  const timeline: TimelineItem[] = [
    ...(interactions.data ?? []).map((i) => ({
      at: i.occurred_at, kind: "interaction" as const,
      node: (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{KIND_LABELS[i.kind]}</span>
            {i.outcome && <Badge tone={i.outcome === "no_answer" ? "neutral" : i.outcome === "needs_followup" ? "warn" : "ok"}>{OUTCOME_LABELS[i.outcome]}</Badge>}
            {i.context === "donor" && <Badge tone="info">תורמים</Badge>}
          </div>
          {i.summary && <p className="text-sm text-ink-2 mt-1 whitespace-pre-line">{i.summary}</p>}
          <p className="text-[12px] text-ink-3 mt-1">{formatDateTime(i.occurred_at)}{i.staff_id ? ` · ${lookups.staffName(i.staff_id)}` : ""}</p>
        </>
      ),
    })),
    ...(cases.data ?? []).map((x) => ({
      at: x.opened_at, kind: "case" as const,
      node: (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/cases/${x.id}`} className="font-medium text-brand hover:underline">{CASE_KIND_LABELS[x.kind]} #{x.ref_no}</Link>
            <Badge tone={x.status === "resolved" ? "ok" : "warn"}>{CASE_STATUS_LABELS[x.status]}</Badge>
          </div>
          {x.message && <p className="text-sm text-ink-2 mt-1 line-clamp-2">{x.message}</p>}
          <p className="text-[12px] text-ink-3 mt-1">{formatDateTime(x.opened_at)}</p>
        </>
      ),
    })),
    ...(donations.data ?? []).map((d) => ({
      at: d.donated_at + "T12:00:00", kind: "donation" as const,
      node: (
        <>
          <p className="text-sm"><span className="font-medium">תרומה</span> · ₪{Number(d.amount).toLocaleString("he-IL")}{d.is_recurring ? " (הוראת קבע)" : ""}</p>
          <p className="text-[12px] text-ink-3 mt-1">{formatDate(d.donated_at)}</p>
        </>
      ),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <>
      <PageHeader
        back={{ href: "/contacts", label: "אנשים" }}
        title={<span className="inline-flex flex-wrap items-center gap-2">{c.full_name}{c.is_demo && <DemoTag />}{c.archived_at && <Badge>בארכיון</Badge>}</span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {status && <CareBadge status={status} />}
            <TypeChips codes={typeCodes} label={lookups.typeLabel} />
            {pink === "paying" && <span className="text-[12px] text-ink-3">משלם/ת פעיל/ה, ולכן לא מופיע/ה ברשימה הורודה</span>}
            {c.cohort_id && <span>מחזור {lookups.cohortLabel(c.cohort_id)}</span>}
            {(c.city || c.region_id) && <span>{[c.city, lookups.regionLabel(c.region_id)].filter(Boolean).join(", ")}</span>}
          </span>
        }
        actions={perms.editContacts(role) ? <LinkButton href={`/contacts/${id}/edit`} size="sm">עריכת פרטים</LinkButton> : undefined}
      />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        {c.phone && <a href={`tel:${c.phone}`} className={buttonClass("secondary")}><Phone className="size-4" aria-hidden />התקשרות</a>}
        {c.phone && <a href={whatsappLink(c.phone)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}><MessageCircle className="size-4" aria-hidden />וואטסאפ</a>}
        {c.email && <a href={`mailto:${c.email}`} className={buttonClass("secondary")}><Mail className="size-4" aria-hidden />דוא״ל</a>}
        {(perms.seeCare(role) || perms.manageDonors(role)) && (
          <Modal trigger="תיעוד שיחה או קשר" title={`תיעוד קשר עם ${c.first_name}`} triggerVariant="primary">
            <LogInteractionForm contactId={id} context={perms.seeCare(role) ? "community" : "donor"} />
          </Modal>
        )}
        {perms.seeCases(role) && <LinkButton href={`/cases/new?contact=${id}`}>פנייה חדשה</LinkButton>}
        {perms.seeCases(role) && <LinkButton href={`/cases/new?contact=${id}&kind=concern`} variant="ghost"><AlertTriangle className="size-4 text-danger" aria-hidden />דיווח חשש</LinkButton>}
        <Modal trigger="משימה" title="משימה חדשה" triggerVariant="ghost">
          <TaskForm contactId={id} staff={lookups.staff} currentUserId={userId} />
        </Modal>
      </div>

      {warnings.length > 0 && (
        <div className="mb-6">
          <Notice tone="warn" title="כדאי לבדוק">
            <ul className="list-disc ps-5 mt-1 space-y-0.5">{warnings.map((w) => <li key={w.text}>{w.text}</li>)}</ul>
          </Notice>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {openCases.length > 0 && (
            <Card>
              <CardHeader title="פניות פתוחות" />
              <ul className="divide-y divide-line border-t border-line">
                {openCases.map((x) => {
                  const late = daysFromToday(x.due_at.slice(0, 10)) < 0;
                  return (
                    <li key={x.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/cases/${x.id}`} className="font-medium text-sm hover:underline">{CASE_KIND_LABELS[x.kind]} #{x.ref_no}</Link>
                        <p className="text-[13px] text-ink-3 truncate">{x.message}</p>
                      </div>
                      <div className="text-end shrink-0">
                        <Badge tone={late ? "danger" : "warn"}>{late ? "באיחור" : CASE_STATUS_LABELS[x.status]}</Badge>
                        <div className="text-[12px] text-ink-3 mt-0.5">{x.assignee_id ? lookups.staffName(x.assignee_id) : "ללא אחראי"}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {(tasks.data ?? []).length > 0 && (
            <Card>
              <CardHeader title="משימות פתוחות" />
              <ul className="divide-y divide-line border-t border-line">
                {(tasks.data ?? []).map((t) => (
                  <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-[12px] text-ink-3">
                        {lookups.staffName(t.assignee_id)}{t.due_date && <> · <span className={cx(daysFromToday(t.due_date) < 0 && "text-danger")}>{relativeDay(t.due_date)}</span></>}
                      </p>
                    </div>
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="done" />
                      <button className={buttonClass("secondary", "sm")}>בוצע</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="היסטוריית קשר" subtitle={timeline.length ? `${timeline.length} רשומות` : undefined} />
            {timeline.length === 0 ? (
              <EmptyState title="עדיין אין תיעוד">כל שיחה, פגישה או הודעה שתתועד תופיע כאן, מהחדשה לישנה.</EmptyState>
            ) : (
              <ol className="border-t border-line px-5 py-4 space-y-5">
                {timeline.map((t, i) => (
                  <li key={i} className="relative ps-5">
                    <span aria-hidden className={cx("absolute start-0 top-1.5 size-2 rounded-full",
                      t.kind === "case" ? "bg-warn" : t.kind === "donation" ? "bg-info" : "bg-brand")} />
                    {t.node}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6 order-first lg:order-none">
          {careRow && (
            <Card>
              <CardHeader title="קשר תקופתי" action={
                <Modal trigger="עדכון" title="עדכון מעקב" triggerVariant="quiet" triggerSize="sm">
                  <CareForm contactId={id} care={careRow} ownerId={c.owner_id} statuses={lookups.statuses} staff={lookups.staff} canEditOwner={perms.editContacts(role)} />
                </Modal>
              } />
              <dl className="px-5 pb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-3">מצב</dt><dd><CareBadge status={status} /></dd>
                <dt className="text-ink-3">אחראי/ת</dt><dd>{lookups.staffName(c.owner_id) || <span className="text-danger">ללא</span>}</dd>
                <dt className="text-ink-3">תדירות</dt><dd>כל {careRow.cadence_days ?? status?.cadence_days ?? 90} ימים{careRow.cadence_days ? " (מותאם אישית)" : ""}</dd>
                <dt className="text-ink-3">קשר אחרון</dt><dd>{careRow.last_contact_at ? `${formatDate(careRow.last_contact_at)} (${relativeDay(careRow.last_contact_at.slice(0, 10))})` : "אין תיעוד"}</dd>
                <dt className="text-ink-3">השיחה הבאה</dt>
                <dd className={cx(careRow.next_contact_at && daysFromToday(careRow.next_contact_at) <= 0 && "text-danger font-medium")}>
                  {careRow.next_contact_at ? `${formatDate(careRow.next_contact_at)} (${relativeDay(careRow.next_contact_at)})` : "לא נקבע"}
                </dd>
                {careRow.snooze_until && daysFromToday(careRow.snooze_until) > 0 && (<><dt className="text-ink-3">ביקש/ה הפסקה</dt><dd>עד {formatDate(careRow.snooze_until)}</dd></>)}
              </dl>
            </Card>
          )}

          {fallen.map((f) => {
            const m = memorialDates(f.fallen.death_date, f.fallen.after_sunset);
            return (
              <Card key={f.fallen.id}>
                <CardHeader title={`${f.relation ?? "בן/בת משפחה"} של ${f.fallen.first_name} ${f.fallen.last_name} ז״ל`} />
                <dl className="px-5 pb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-ink-3">יום האזכרה</dt><dd>{m.azkaraHebrew} · {formatDate(m.nextAzkara)} ({relativeDay(m.nextAzkara)})</dd>
                  <dt className="text-ink-3">יום השנה</dt><dd>{formatDate(m.nextAnniversary)}</dd>
                </dl>
              </Card>
            );
          })}

          {(isMember || benefits.length > 0) && (
            <Card>
              <CardHeader title="חברות ושירותי העמותה" />
              <dl className="px-5 pb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {isMember && (<>
                  <dt className="text-ink-3">חבר/ת עמותה</dt>
                  <dd>{activeMember ? <Badge tone="ok">פעיל/ה</Badge> : <Badge tone="warn">לא שילם/ה בשנה האחרונה</Badge>}
                    {c.member_since && <span className="text-[12px] text-ink-3 ms-2">מאז {formatDate(c.member_since)}</span>}</dd>
                  {c.last_paid_at && (<><dt className="text-ink-3">תשלום אחרון</dt><dd>{formatDate(c.last_paid_at)}</dd></>)}
                </>)}
              </dl>
              {benefits.length > 0 && (
                <ul className="divide-y divide-line border-t border-line">
                  {benefits.map((u) => (
                    <li key={u.id} className="px-5 py-2 text-sm flex justify-between gap-3">
                      <span>{u.provider === "nexus" ? "נקסוס" : "שירות"}{u.description ? ` · ${u.description}` : ""}</span>
                      <span className="text-ink-3 text-[12px] whitespace-nowrap">{formatDate(u.used_at)}{u.amount ? ` · ₪${Number(u.amount).toLocaleString("he-IL")}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {connectedFallen.length > 0 && (
            <Card>
              <CardHeader title="חללי הסיירת שמחוברים אליו/ה" subtitle="מאותו מחזור, או שגרו באותו יישוב" />
              <ul className="divide-y divide-line border-t border-line">
                {connectedFallen.map(({ f, reasons, m }) => (
                  <li key={f.id} className="px-5 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/calendar/fallen/${f.id}`} className="font-medium text-ink hover:text-brand hover:underline">{f.first_name} {f.last_name} ז״ל</Link>
                      {reasons.has("cohort") && <Badge>אותו מחזור</Badge>}
                      {reasons.has("city") && <Badge>גר ב{f.residence}</Badge>}
                    </div>
                    <div className="text-[12px] text-ink-3 mt-0.5">יום האזכרה: {m.azkaraHebrew} · {formatDate(m.nextAzkara)} ({relativeDay(m.nextAzkara)})</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="פרטי קשר" />
            <dl className="px-5 pb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">טלפון</dt>
              <dd dir="ltr" className="text-end">{c.phone ? displayPhone(c.phone) : "—"} {c.phone_status === "invalid" && <Badge tone="danger">לא תקין</Badge>}</dd>
              <dt className="text-ink-3">דוא״ל</dt><dd dir="ltr" className="text-end break-all">{c.email ?? "—"}</dd>
              {c.birth_date && (<><dt className="text-ink-3">תאריך לידה</dt><dd>{formatDate(c.birth_date)}</dd></>)}
              {c.profession && (<><dt className="text-ink-3">מקצוע</dt><dd>{c.profession}</dd></>)}
              {c.skills.length > 0 && (<><dt className="text-ink-3">כישורים</dt><dd className="flex flex-wrap gap-1">{c.skills.map((s) => <Badge key={s}>{s}</Badge>)}</dd></>)}
              {c.available_to_help && (<><dt className="text-ink-3">נכונות לעזור</dt><dd>כן{c.skills_share_consent ? ", הסכים/ה שנפנה אליו/ה" : ""}</dd></>)}
              <dt className="text-ink-3">קמפיינים</dt><dd>{c.campaign_consent === true ? "הסכים/ה" : c.campaign_consent === false ? "לא הסכים/ה" : "לא ידוע"}</dd>
              <dt className="text-ink-3">אומת לאחרונה</dt><dd>{c.verified_at ? `${formatDate(c.verified_at)} (${c.verified_by === "self" ? "על ידי האדם" : "על ידי הצוות"})` : "מעולם לא"}</dd>
              <dt className="text-ink-3">מקור</dt><dd>{SOURCE_LABELS[c.source] ?? c.source}</dd>
            </dl>
            {c.notes && <p className="px-5 pb-4 text-sm text-ink-2 whitespace-pre-line border-t border-line pt-3">{c.notes}</p>}
            <div className="px-5 pb-5 pt-1 flex flex-wrap gap-2 border-t border-line pt-4">
              {perms.editContacts(role) && (
                <form action={markVerified}><input type="hidden" name="id" value={id} /><button className={buttonClass("secondary", "sm")}>אימתתי את הפרטים היום</button></form>
              )}
              {perms.editContacts(role) && c.phone && (
                <form action={markPhone}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value={c.phone_status === "invalid" ? "valid" : "invalid"} />
                  <button className={buttonClass("ghost", "sm")}>{c.phone_status === "invalid" ? "המספר תקין" : "המספר לא תקין"}</button>
                </form>
              )}
              {role !== "volunteer" && <UpdateLinkButton contactId={id} phone={c.phone} firstName={c.first_name} />}
            </div>
          </Card>

          {perms.mergeContacts(role) && (
            <form action={archiveContact} className="text-center">
              <input type="hidden" name="id" value={id} />
              {c.archived_at && <input type="hidden" name="restore" value="1" />}
              <button className="text-[13px] text-ink-3 hover:text-danger underline">{c.archived_at ? "החזרה מהארכיון" : "העברה לארכיון"}</button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

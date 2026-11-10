import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Card, DemoTag, EmptyState, LinkButton, Notice, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { FlagChips, KindBadge, PRIORITY_TONE, STATUS_TONE, caseFlags, caseWho, dueText, isLate, nowMs } from "@/components/cases/flags";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { CASE_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { ATTENTION_FILTER } from "@/lib/alerts";
import type { Case, CaseAlert } from "@/lib/types";

export const metadata: Metadata = { title: "פניות וקריאות סיוע" };

const LIMIT = 200;

const TABS = [
  { key: "attention", label: "דורש טיפול" },
  { key: "mine", label: "שלי" },
  { key: "open", label: "כל הפתוחות" },
  { key: "resolved", label: "טופלו" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Row = Pick<Case, "id" | "ref_no" | "kind" | "status" | "priority" | "assignee_id" | "contact_id" | "subject_name" | "requester_name" |
  "message" | "opened_at" | "due_at" | "last_activity_at" | "resolved_at" | "is_demo"> & { contacts: { full_name: string } | null };
type AlertRow = Pick<CaseAlert, "id" | "unassigned" | "overdue" | "stalled" | "closed_without_action">;

const SELECT = "id,ref_no,kind,status,priority,assignee_id,contact_id,subject_name,requester_name,message,opened_at,due_at,last_activity_at,resolved_at,is_demo,suspected_spam,contacts:contacts!cases_contact_id_fkey(full_name)";

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff, userId } = await requireStaff();
  if (!perms.seeCases(staff.role)) redirect("/");
  const supabase = await createClient();
  const lookups = await getLookups();
  const now = nowMs();

  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "attention";
  const kind = sp.kind === "request" || sp.kind === "concern" ? sp.kind : undefined;
  const priority = sp.priority === "normal" || sp.priority === "high" || sp.priority === "urgent" ? sp.priority : undefined;
  const assignee = sp.assignee;

  // Filters work the same on `cases` and on the `case_alerts` view (same column names).
  // Typed loosely inside on purpose: the Supabase builder generics are too deep to express here.
  const filter = <T,>(q: T): T => {
    let r: any = q; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (kind) r = r.eq("kind", kind);
    if (priority) r = r.eq("priority", priority);
    if (assignee === "me") r = r.eq("assignee_id", userId);
    else if (assignee === "none") r = r.is("assignee_id", null);
    else if (assignee && /^[0-9a-f-]{36}$/i.test(assignee)) r = r.eq("assignee_id", assignee);
    return r;
  };

  const attentionOr = ATTENTION_FILTER;

  // Tab counters (ignore the filters, so the numbers stay stable while filtering)
  const [attnCount, mineCount] = await Promise.all([
    supabase.from("case_alerts").select("id", { count: "exact", head: true }).neq("status", "resolved").or(attentionOr),
    supabase.from("cases").select("id", { count: "exact", head: true }).neq("status", "resolved").eq("assignee_id", userId),
  ]);

  let rows: Row[] = [];
  let failed = false;
  let total = 0;

  if (tab === "attention") {
    const { data: ids, error, count } = await filter(
      supabase.from("case_alerts").select("id", { count: "exact" }).neq("status", "resolved").or(attentionOr),
    ).order("due_at").limit(LIMIT);
    failed = !!error;
    total = count ?? 0;
    const list = (ids ?? []).map((r) => r.id as string);
    if (list.length) {
      const res = await supabase.from("cases").select(SELECT).in("id", list)
        .order("priority", { ascending: false }).order("due_at");
      failed ||= !!res.error;
      rows = (res.data ?? []) as unknown as Row[];
    }
  } else {
    let q = filter(supabase.from("cases").select(SELECT, { count: "exact" }));
    if (tab === "mine") q = q.eq("assignee_id", userId).neq("status", "resolved");
    if (tab === "open") q = q.neq("status", "resolved");
    if (tab === "resolved") q = q.eq("status", "resolved");
    q = tab === "resolved"
      ? q.order("resolved_at", { ascending: false })
      : q.order("priority", { ascending: false }).order("due_at");
    const { data, error, count } = await q.limit(LIMIT);
    failed = !!error;
    total = count ?? 0;
    rows = (data ?? []) as unknown as Row[];
  }

  const alertsRes = rows.length
    ? await supabase.from("case_alerts").select("id,unassigned,overdue,stalled,closed_without_action").in("id", rows.map((r) => r.id))
    : { data: [] as AlertRow[] };
  const alerts = new Map(((alertsRes.data ?? []) as AlertRow[]).map((a) => [a.id, a]));

  const filtersActive = !!(kind || priority || assignee);
  const tabHref = (t: TabKey) => {
    const u = new URLSearchParams();
    if (t !== "attention") u.set("tab", t);
    if (kind) u.set("kind", kind);
    if (priority) u.set("priority", priority);
    if (assignee) u.set("assignee", assignee);
    const s = u.toString();
    return s ? `/cases?${s}` : "/cases";
  };
  const counts: Partial<Record<TabKey, number>> = { attention: attnCount.count ?? 0, mine: mineCount.count ?? 0 };
  const seeAll = perms.seeAllCases(staff.role);
  const clearHref = tab === "attention" ? "/cases" : `/cases?tab=${tab}`;

  return (
    <>
      <PageHeader
        title="פניות וקריאות סיוע"
        description={seeAll
          ? "כל מי שביקש עזרה, וכל דיווח על חבר שמדאיג. שום פנייה לא נשארת בלי מענה."
          : staff.role === "cohort_lead"
            ? "פניות שבאחריותך, שפתחת, או של אנשים מהמחזורים והאזורים שלך."
            : "פניות שבאחריותך או שפתחת."}
        actions={<LinkButton href="/cases/new" variant="primary" size="sm"><Plus className="size-4" aria-hidden />פנייה חדשה</LinkButton>}
      />

      {sp.handed && (
        <div className="mb-4"><Notice tone="ok" title="הפנייה הועברה">היא כבר לא באחריותך, ולכן לא מופיעה אצלך.</Notice></div>
      )}

      <nav aria-label="תצוגות" className="mb-4 -mx-4 px-4 overflow-x-auto">
        <ul className="flex gap-1 border-b border-line min-w-max">
          {TABS.map((t) => {
            const active = t.key === tab;
            const n = counts[t.key];
            return (
              <li key={t.key}>
                <Link
                  href={tabHref(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "inline-flex items-center gap-2 h-10 px-3 -mb-px border-b-2 text-sm transition-colors",
                    active ? "border-brand text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink",
                  )}
                >
                  {t.label}
                  {n !== undefined && n > 0 && (
                    <span className={cx("min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center tabular-nums",
                      t.key === "attention" ? "bg-danger text-white" : "bg-muted-soft text-ink-2")}>
                      {n > 99 ? "99+" : n}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <AutoSubmitForm className="flex flex-wrap gap-2 mb-4">
        {tab !== "attention" && <input type="hidden" name="tab" value={tab} />}
        <Select name="kind" defaultValue={kind ?? ""} aria-label="סוג" className="w-auto h-9">
          <option value="">פניות ודיווחי חשש</option>
          <option value="request">פניות בלבד</option>
          <option value="concern">דיווחי חשש בלבד</option>
        </Select>
        <Select name="priority" defaultValue={priority ?? ""} aria-label="עדיפות" className="w-auto h-9">
          <option value="">כל העדיפויות</option>
          {(["urgent", "high", "normal"] as const).map((p) => <option key={p} value={p}>עדיפות {PRIORITY_LABELS[p]}</option>)}
        </Select>
        {tab !== "mine" && (
          <Select name="assignee" defaultValue={assignee ?? ""} aria-label="אחראי/ת" className="w-auto h-9">
            <option value="">כל האחראים</option>
            <option value="me">באחריותי</option>
            <option value="none">ללא אחראי</option>
            {lookups.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </Select>
        )}
        <noscript><button className={buttonClass("secondary", "sm")}>סינון</button></noscript>
        {filtersActive && <Link href={clearHref} className="text-sm text-brand self-center hover:underline">ניקוי</Link>}
      </AutoSubmitForm>

      {tab === "attention" && rows.length > 0 && (
        <p className="text-[13px] text-ink-3 mb-3">
          כאן מופיעות פניות פתוחות שמחכות למישהו: בלי אחראי/ת, שעבר המועד שלהן, שאין בהן פעילות שבוע, וכל דיווחי החשש הפתוחים.
        </p>
      )}

      {failed && <p role="alert" className="text-sm text-danger mb-3">טעינת הפניות נכשלה. רעננו את הדף.</p>}

      <Card>
        {rows.length === 0 ? (
          <Empty tab={tab} filtersActive={filtersActive} clearHref={clearHref} />
        ) : (
          <>
            {/* desktop table */}
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">{TABS.find((t) => t.key === tab)?.label}</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 ps-5 pe-3 w-20">מס׳</th>
                  <th scope="col" className="text-start font-medium px-3">מי ומה</th>
                  <th scope="col" className="text-start font-medium px-3">מה דורש תשומת לב</th>
                  <th scope="col" className="text-start font-medium px-3">אחראי/ת</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">{tab === "resolved" ? "נסגרה" : "לטפל עד"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const flags = caseFlags(alerts.get(r.id), r, now);
                  const late = isLate(r.due_at, r.status, now);
                  const who = caseWho(r);
                  return (
                    <tr key={r.id} className="hover:bg-canvas align-top">
                      <td className="py-3 ps-5 pe-3">
                        <Link href={`/cases/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline tabular-nums">#{r.ref_no}</Link>
                      </td>
                      <td className="py-3 px-3 max-w-md">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <KindBadge kind={r.kind} />
                          <Link href={`/cases/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline">{who || "ללא שם"}</Link>
                          {r.priority !== "normal" && <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>}
                          {r.status !== "resolved" && <span className="text-[12px] text-ink-3">· {CASE_STATUS_LABELS[r.status]}</span>}
                          {r.is_demo && <DemoTag />}
                        </div>
                        {r.message && <p className="text-[13px] text-ink-2 mt-1 line-clamp-2">{r.message}</p>}
                      </td>
                      <td className="py-3 px-3">{flags.length ? <FlagChips flags={flags} /> : <span className="text-ink-3">—</span>}</td>
                      <td className="py-3 px-3 text-ink-2">{r.assignee_id ? lookups.staffName(r.assignee_id) || "—" : <span className="text-danger">ללא</span>}</td>
                      <td className={cx("py-3 px-3 pe-5 whitespace-nowrap", late ? "text-danger font-medium" : "text-ink-2")}>
                        {tab === "resolved" ? formatDate(r.resolved_at) : dueText(r.due_at, r.status, now)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* mobile cards */}
            <ul className="md:hidden divide-y divide-line">
              {rows.map((r) => {
                const flags = caseFlags(alerts.get(r.id), r, now);
                const late = isLate(r.due_at, r.status, now);
                return (
                  <li key={r.id}>
                    <Link href={`/cases/${r.id}`} className="block px-4 py-3 active:bg-canvas">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[12px] text-ink-3 tabular-nums">#{r.ref_no}</span>
                            <KindBadge kind={r.kind} />
                            {r.priority !== "normal" && <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>}
                            {r.is_demo && <DemoTag />}
                          </div>
                          <div className="font-medium mt-1">{caseWho(r) || "ללא שם"}</div>
                        </div>
                        <Badge tone={STATUS_TONE[r.status]}>{CASE_STATUS_LABELS[r.status]}</Badge>
                      </div>
                      {r.message && <p className="text-[13px] text-ink-2 mt-1 line-clamp-2">{r.message}</p>}
                      {flags.length > 0 && <div className="mt-2"><FlagChips flags={flags} /></div>}
                      <div className="text-[12px] text-ink-3 mt-2 flex flex-wrap gap-x-3">
                        <span>{r.assignee_id ? lookups.staffName(r.assignee_id) || "—" : "ללא אחראי"}</span>
                        <span className={cx(late && "text-danger font-medium")}>
                          {tab === "resolved" ? `נסגרה ${formatDate(r.resolved_at)}` : dueText(r.due_at, r.status, now)}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {total > rows.length && (
        <p className="text-[13px] text-ink-3 mt-3">מוצגות {rows.length} מתוך {total.toLocaleString("he-IL")}. אפשר לצמצם בעזרת הסינון.</p>
      )}
    </>
  );
}

function Empty({ tab, filtersActive, clearHref }: { tab: TabKey; filtersActive: boolean; clearHref: string }) {
  if (filtersActive) {
    return (
      <EmptyState title="אין פניות שמתאימות לסינון" action={<LinkButton href={clearHref} size="sm">ניקוי הסינון</LinkButton>}>
        נסו לשנות את הסוג, העדיפות או האחראי/ת.
      </EmptyState>
    );
  }
  switch (tab) {
    case "attention":
      return (
        <EmptyState title="הכול מטופל" action={<LinkButton href="/cases?tab=open" size="sm">לכל הפניות הפתוחות</LinkButton>}>
          אין כרגע פניות באיחור, בלי אחראי/ת, תקועות או דיווחי חשש פתוחים.
        </EmptyState>
      );
    case "mine":
      return <EmptyState title="אין פניות פתוחות באחריותך">כשתשובץ/י לפנייה, היא תופיע כאן.</EmptyState>;
    case "open":
      return (
        <EmptyState title="אין פניות פתוחות" action={<LinkButton href="/cases/new" variant="primary" size="sm">פנייה חדשה</LinkButton>}>
          פניות מהאתר (&quot;אני צריך לדבר&quot;, &quot;מודאג לגבי חבר&quot;) ופניות שהצוות פותח יופיעו כאן.
        </EmptyState>
      );
    case "resolved":
      return <EmptyState title="עדיין אין פניות שטופלו">פנייה נסגרת אחרי שמתעדים מה נעשה.</EmptyState>;
  }
}

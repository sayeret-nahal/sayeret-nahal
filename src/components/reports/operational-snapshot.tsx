import { Card, CardHeader, Notice, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, todayIL } from "@/lib/dates";
import { CASE_STATUS_LABELS } from "@/lib/labels";
import type { CaseStatus } from "@/lib/types";
import { BarTable, type BarRow } from "./bar-table";

const PAGE = 1000;
const CAP = 50_000;

type Result<T> = { rows: T[]; failed: boolean; truncated: boolean };

/** Read every row of a query in pages (the API returns at most 1,000 rows per request). */
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Result<T>> {
  const rows: T[] = [];
  for (let from = 0; from < CAP; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) return { rows, failed: true, truncated: false };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, failed: false, truncated: false };
  }
  return { rows, failed: false, truncated: true };
}

type StaffRow = { id: string; full_name: string; is_active: boolean };

function countBy<T>(rows: T[], key: (r: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const NONE = "";

/** Operational snapshot for admin / manager / coordinator. All queries run under the user's RLS. */
export async function OperationalSnapshot() {
  const supabase = await createClient();
  const today = todayIL();
  const now = new Date().toISOString();

  const [cases, tasks, calls, noOwner, notVerified, staffRes, staleSetting] = await Promise.all([
    fetchAll<{ id: string; status: CaseStatus; assignee_id: string | null; due_at: string }>((a, b) =>
      supabase.from("cases").select("id,status,assignee_id,due_at").neq("status", "resolved").order("id").range(a, b)),
    fetchAll<{ id: string; assignee_id: string | null }>((a, b) =>
      supabase.from("tasks").select("id,assignee_id").eq("status", "open").lt("due_date", today).order("id").range(a, b)),
    fetchAll<{ contact_id: string; contacts: { owner_id: string | null } }>((a, b) =>
      supabase.from("contact_care")
        .select("contact_id,contacts!inner(owner_id)")
        .lte("next_contact_at", today)
        .is("contacts.archived_at", null).is("contacts.merged_into", null)
        .or(`snooze_until.is.null,snooze_until.lte.${today}`)
        .order("contact_id").range(a, b)),
    supabase.from("contacts").select("id", { count: "exact", head: true }).is("owner_id", null).is("archived_at", null).is("merged_into", null),
    supabase.from("contact_health").select("contact_id", { count: "exact", head: true }).eq("not_verified", true),
    supabase.from("staff").select("id,full_name,is_active").returns<StaffRow[]>(),
    supabase.from("settings").select("value").eq("key", "stale_after_days").maybeSingle<{ value: number }>(),
  ]);

  const staff = new Map((staffRes.data ?? []).map((s) => [s.id, s]));
  const nameOf = (id: string) => {
    if (id === NONE) return <span className="text-ink-3">ללא אחראי/ת</span>;
    const s = staff.get(id);
    if (!s) return <span className="text-ink-3">משתמש/ת שהוסר/ה</span>;
    return s.is_active ? s.full_name : <>{s.full_name} <span className="text-[12px] text-danger">(חשבון מושבת)</span></>;
  };

  const failed = [cases, tasks, calls].some((r) => r.failed) || !!noOwner.error || !!notVerified.error;
  const truncated = [cases, tasks, calls].some((r) => r.truncated);

  // ---- cases ----
  const openCases = cases.rows;
  const overdueCases = openCases.filter((c) => c.due_at < now);
  const byStatus = countBy(openCases, (c) => c.status);
  const statusRows: BarRow[] = (["new", "in_progress", "waiting"] as const).map((s) => ({
    key: s, label: CASE_STATUS_LABELS[s], values: [byStatus.get(s) ?? 0, overdueCases.filter((c) => c.status === s).length], alert: true,
  }));
  const caseOpenBy = countBy(openCases, (c) => c.assignee_id);
  const caseOverdueBy = countBy(overdueCases, (c) => c.assignee_id);
  const caseRows: BarRow[] = [...caseOpenBy.entries()]
    .map(([id, open]) => ({ key: id || "none", label: nameOf(id), values: [open, caseOverdueBy.get(id) ?? 0], alert: true }))
    .sort((a, b) => b.values[1] - a.values[1] || b.values[0] - a.values[0]);

  // ---- tasks ----
  const taskBy = countBy(tasks.rows, (t) => t.assignee_id);
  const taskRows: BarRow[] = [...taskBy.entries()]
    .map(([id, n]) => ({ key: id || "none", label: nameOf(id), values: [n], href: id ? `/follow-up?tab=tasks&whose=${id}` : undefined }))
    .sort((a, b) => b.values[0] - a.values[0]);

  // ---- "how are you" calls ----
  const callBy = countBy(calls.rows, (c) => c.contacts?.owner_id ?? null);
  const callRows: BarRow[] = [...callBy.entries()]
    .map(([id, n]) => ({ key: id || "none", label: nameOf(id), values: [n], href: id ? `/follow-up?tab=calls&whose=${id}` : "/follow-up?tab=unowned" }))
    .sort((a, b) => b.values[0] - a.values[0]);

  const staleDays = Number(staleSetting.data?.value ?? 365) || 365;
  const unassignedCases = caseOpenBy.get(NONE) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-ink-3">מצב נכון ל-{formatDateTime(now)}. המספרים מתעדכנים בכל טעינה של הדף.</p>

      {failed && <Notice tone="danger" title="חלק מהנתונים לא נטענו">רעננו את הדף. אם זה חוזר, פנו למנהל/ת המערכת.</Notice>}
      {truncated && <Notice tone="warn">יש יותר מ-{CAP.toLocaleString("he-IL")} רשומות באחת הרשימות, ולכן חלק מהספירות חלקיות.</Notice>}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="פניות פתוחות" value={openCases.length.toLocaleString("he-IL")} href="/cases"
          hint={unassignedCases ? `${unassignedCases} מהן ללא אחראי/ת` : "לכולן יש אחראי/ת"} tone={unassignedCases ? "warn" : "neutral"} />
        <Stat label="פניות באיחור" value={overdueCases.length.toLocaleString("he-IL")} href="/cases"
          hint="עבר מועד היעד ועדיין לא טופלו" tone={overdueCases.length ? "danger" : "neutral"} />
        <Stat label="שיחות שהגיע זמנן" value={calls.rows.length.toLocaleString("he-IL")} href="/follow-up?tab=calls&whose=all"
          hint={'שיחות "מה שלומך" עד היום, לא כולל השהיות'} tone={calls.rows.length ? "warn" : "neutral"} />
        <Stat label="משימות באיחור" value={tasks.rows.length.toLocaleString("he-IL")} href="/follow-up?tab=tasks&whose=all"
          hint="פתוחות, ותאריך היעד עבר" tone={tasks.rows.length ? "warn" : "neutral"} />
        <Stat label="אנשים ללא אחראי/ת" value={(noOwner.count ?? 0).toLocaleString("he-IL")} href="/contacts?owner=none"
          hint="אף אחד לא אחראי/ת על הקשר איתם" />
        <Stat label="פרטים שלא אומתו" value={(notVerified.count ?? 0).toLocaleString("he-IL")} href="/contacts?health=not_verified"
          hint={`לא אומתו מעולם, או לפני יותר מ-${staleDays} ימים`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="פניות פתוחות לפי מצב" subtitle="כמה פניות נמצאות בכל שלב, וכמה מהן באיחור" />
          <BarTable caption="פניות פתוחות לפי מצב" nameHeader="מצב" valueHeaders={["פתוחות", "באיחור"]} rows={statusRows}
            empty="אין פניות פתוחות" />
        </Card>

        <Card>
          <CardHeader title="פניות לפי אחראי/ת" subtitle="ממוין לפי מספר הפניות שבאיחור" />
          <BarTable caption="פניות פתוחות ובאיחור לפי אחראי/ת" nameHeader="אחראי/ת" valueHeaders={["פתוחות", "באיחור"]} rows={caseRows}
            empty="אין פניות פתוחות" emptyHint="כשתיפתח פנייה, היא תופיע כאן לפי מי שמטפל/ת בה." />
        </Card>

        <Card>
          <CardHeader title="משימות באיחור לפי אחראי/ת" subtitle="משימות פתוחות שתאריך היעד שלהן עבר" />
          <BarTable caption="משימות באיחור לפי אחראי/ת" nameHeader="אחראי/ת" valueHeaders={["באיחור"]} rows={taskRows} barTone="warn"
            empty="אין משימות באיחור" emptyHint="כל המשימות הפתוחות עדיין בזמן." />
        </Card>

        <Card>
          <CardHeader title={'שיחות "מה שלומך" שהגיע זמנן'} subtitle="לפי האחראי/ת על הקשר. לא כולל אנשים שביקשו הפסקה זמנית." />
          <BarTable caption="שיחות שהגיע זמנן לפי אחראי/ת" nameHeader="אחראי/ת" valueHeaders={["שיחות"]} rows={callRows} barTone="info"
            empty="אין שיחות שהגיע זמנן" emptyHint="כל השיחות המתוכננות עדיין לא הגיעו למועדן." />
        </Card>
      </div>
    </div>
  );
}

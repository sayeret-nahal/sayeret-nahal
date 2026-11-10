import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, Input, Notice, PageHeader, Select, buttonClass, type Tone } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { requireAdmin } from "@/components/admin/guard";
import { ACTION_LABELS, AuditChanges, TABLE_LABELS } from "@/components/admin/audit-format";
import { getLookups } from "@/lib/data";
import { addDays, formatDateTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "יומן פעולות" };

const PAGE = 50;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuditRow = { id: number; at: string; actor_id: string | null; action: string; table_name: string | null; record_id: string | null; changes: unknown };

/** Midnight in Israel for a YYYY-MM-DD date, as an ISO timestamp (handles summer / winter time). */
function ilMidnight(date: string): string {
  const probe = new Date(date + "T12:00:00Z");
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" })
    .formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const off = m ? `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}` : "+02:00";
  return new Date(`${date}T00:00:00${off}`).toISOString();
}

function actionTone(action: string): Tone {
  if (action === "delete") return "danger";
  if (action === "export") return "warn";
  if (action === "update" || action === "merge") return "info";
  if (action === "insert") return "ok";
  return "neutral";
}

function recordHref(table: string | null, id: string | null): string | null {
  if (!id || !UUID.test(id)) return null;
  if (table === "contacts" || table === "contact_care" || table === "contact_type_links" || table === "fallen_family") return `/contacts/${id}`;
  if (table === "cases") return `/cases/${id}`;
  return null;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireAdmin();
  const supabase = await createClient();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const [lookups, allStaff] = await Promise.all([
    getLookups(),
    supabase.from("staff").select("id,full_name,is_active").order("full_name").returns<{ id: string; full_name: string; is_active: boolean }[]>(),
  ]);
  const staffList = allStaff.data ?? [];
  // lookups.staffName covers active staff; fall back to the full list for people who were deactivated.
  const names = (id: string) => lookups.staffName(id) || staffList.find((s) => s.id === id)?.full_name || "";

  let q = supabase.from("audit_log").select("*", { count: "exact" });
  if (sp.actor && UUID.test(sp.actor)) q = q.eq("actor_id", sp.actor);
  if (sp.action) q = q.eq("action", sp.action);
  if (sp.table) q = q.eq("table_name", sp.table);
  if (sp.from && ISO.test(sp.from)) q = q.gte("at", ilMidnight(sp.from));
  if (sp.to && ISO.test(sp.to)) q = q.lt("at", ilMidnight(addDays(sp.to, 1)));
  const { data, count, error } = await q.order("at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtersActive = ["actor", "action", "table", "from", "to"].some((k) => sp[k]);
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    u.set("page", String(p));
    return `?${u}`;
  };
  const actorLabel = (id: string | null) => (id ? names(id) || "משתמש/ת שהוסר/ה" : "המערכת / טופס ציבורי");

  return (
    <>
      <PageHeader
        title="יומן פעולות"
        description="מי ראה, שינה, ייצא או מחק מידע, ומתי. היומן נכתב אוטומטית ואי אפשר לערוך או למחוק בו רשומות."
        back={{ href: "/admin", label: "ניהול" }}
      />

      <div className="mb-5">
        <Notice tone="info" title="שמירת היומן">
          תקנות הגנת הפרטיות (אבטחת מידע) מחייבות לשמור את רישומי הגישה למאגר <strong>לפחות 24 חודשים</strong>, ולבדוק אותם מדי פעם.
          כדאי לעבור על היומן פעם בחודש ולחפש דברים חריגים: ייצוא שלא תואם, צפייה בהרבה כרטיסים בבת אחת, או כניסות בשעות לא רגילות.
        </Notice>
      </div>

      <AutoSubmitForm className="flex flex-wrap items-end gap-2 mb-4">
        <Select name="actor" defaultValue={sp.actor ?? ""} aria-label="משתמש/ת" className="w-auto h-9">
          <option value="">כל המשתמשים</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.is_active ? "" : " (מושבת/ת)"}</option>)}
        </Select>
        <Select name="action" defaultValue={sp.action ?? ""} aria-label="פעולה" className="w-auto h-9">
          <option value="">כל הפעולות</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="table" defaultValue={sp.table ?? ""} aria-label="סוג מידע" className="w-auto h-9">
          <option value="">כל סוגי המידע</option>
          {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <div className="flex items-center gap-1.5">
          <label htmlFor="audit-from" className="text-[13px] text-ink-2">מ-</label>
          <Input id="audit-from" name="from" type="date" defaultValue={sp.from ?? ""} className="h-9 w-40" />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="audit-to" className="text-[13px] text-ink-2">עד</label>
          <Input id="audit-to" name="to" type="date" defaultValue={sp.to ?? ""} className="h-9 w-40" />
        </div>
        <noscript><button className={buttonClass("secondary", "sm")}>סינון</button></noscript>
        {filtersActive && <Link href="/admin/audit" className="text-sm text-brand self-center hover:underline">ניקוי</Link>}
      </AutoSubmitForm>

      {error && <p role="alert" className="text-sm text-danger mb-3">טעינת היומן נכשלה. רעננו את הדף.</p>}
      <p className="text-[13px] text-ink-3 mb-2" aria-live="polite">{total.toLocaleString("he-IL")} רשומות{filtersActive ? " תואמות לסינון" : ""}</p>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filtersActive ? "אין רשומות שתואמות לסינון" : "היומן ריק"}>
            {filtersActive ? "נסו להרחיב את טווח התאריכים או לבטל חלק מהסינון." : "פעולות במערכת יירשמו כאן אוטומטית."}
          </EmptyState>
        ) : (
          <>
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">יומן פעולות, מהחדש לישן</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 ps-5 pe-3 w-36">מתי</th>
                  <th scope="col" className="text-start font-medium px-3 w-40">מי</th>
                  <th scope="col" className="text-start font-medium px-3 w-32">פעולה</th>
                  <th scope="col" className="text-start font-medium px-3 w-40">על מה</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">פרטים</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const href = recordHref(r.table_name, r.record_id);
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="py-2.5 ps-5 pe-3 text-ink-2 whitespace-nowrap tabular-nums">{formatDateTime(r.at)}</td>
                      <td className="py-2.5 px-3">{actorLabel(r.actor_id)}</td>
                      <td className="py-2.5 px-3"><Badge tone={actionTone(r.action)}>{ACTION_LABELS[r.action] ?? r.action}</Badge></td>
                      <td className="py-2.5 px-3 text-ink-2">
                        {r.table_name ? TABLE_LABELS[r.table_name] ?? r.table_name : "—"}
                        {r.record_id && (
                          <div className="text-[12px]">
                            {href ? <Link href={href} className="text-brand hover:underline">פתיחת הרשומה</Link>
                              : <span className="text-ink-3 break-all" dir="ltr">{r.record_id.length > 24 ? r.record_id.slice(0, 8) + "…" : r.record_id}</span>}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 pe-5"><AuditChanges action={r.action} changes={r.changes} names={names} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-line">
              {rows.map((r) => {
                const href = recordHref(r.table_name, r.record_id);
                return (
                  <li key={r.id} className="px-4 py-3 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={actionTone(r.action)}>{ACTION_LABELS[r.action] ?? r.action}</Badge>
                      <span className="font-medium">{actorLabel(r.actor_id)}</span>
                    </div>
                    <div className="text-[12px] text-ink-3">
                      {formatDateTime(r.at)}
                      {r.table_name && ` · ${TABLE_LABELS[r.table_name] ?? r.table_name}`}
                      {href && <> · <Link href={href} className="text-brand hover:underline">פתיחת הרשומה</Link></>}
                    </div>
                    <AuditChanges action={r.action} changes={r.changes} names={names} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {pages > 1 && (
        <nav aria-label="דפים" className="flex items-center justify-between mt-4 text-sm">
          {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={qs(page - 1)}>→ חדשות יותר</Link> : <span />}
          <span className="text-ink-3">עמוד {page} מתוך {pages.toLocaleString("he-IL")}</span>
          {page < pages ? <Link className={buttonClass("secondary", "sm")} href={qs(page + 1)}>ישנות יותר ←</Link> : <span />}
        </nav>
      )}
    </>
  );
}

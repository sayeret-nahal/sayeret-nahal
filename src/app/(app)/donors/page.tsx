import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { Badge, Card, DemoTag, EmptyState, Input, LinkButton, Notice, PageHeader, Select, Stat, buttonClass, cx } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { AddDonationDialog } from "@/components/donors/dialogs";
import { ConsentBadge, DonorsTabs } from "@/components/donors/parts";
import { ils } from "@/components/donors/format";
import { chunk, fetchAll } from "@/components/donors/queries";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, relativeDay, todayIL } from "@/lib/dates";

export const metadata: Metadata = { title: "תורמים" };

const PAGE = 50;

type DonationLite = { contact_id: string; amount: number; currency: string; donated_at: string; is_recurring: boolean };
type Person = { id: string; full_name: string; phone: string | null; owner_id: string | null; campaign_consent: boolean | null; is_demo: boolean; merged_into: string | null; archived_at: string | null };
type Donor = Person & { total: number; count: number; last: string | null; recurring: boolean; otherCurrency: boolean };

export default async function DonorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  if (!perms.manageDonors(staff.role)) redirect("/");
  const supabase = await createClient();
  const today = todayIL();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearAgo = addDays(today, -365);

  const [lookups, donations, tagged, campaigns] = await Promise.all([
    getLookups(),
    fetchAll<DonationLite>((from, to) =>
      supabase.from("donations").select("contact_id,amount,currency,donated_at,is_recurring").order("id").range(from, to)),
    fetchAll<{ contact_id: string }>((from, to) =>
      supabase.from("contact_type_links").select("contact_id").eq("type_code", "donor").order("contact_id").range(from, to)),
    supabase.from("campaigns").select("id,name").order("name"),
  ]);

  // aggregate per person
  const agg = new Map<string, { total: number; count: number; last: string | null; recurring: boolean; otherCurrency: boolean }>();
  const blank = () => ({ total: 0, count: 0, last: null as string | null, recurring: false, otherCurrency: false });
  let yearSum = 0, yearCount = 0;
  const yearDonors = new Set<string>();
  const recurringDonors = new Set<string>();
  for (const d of donations.rows) {
    const a = agg.get(d.contact_id) ?? blank();
    if (d.currency === "ILS") a.total += Number(d.amount);
    else a.otherCurrency = true;
    a.count++;
    if (!a.last || d.donated_at > a.last) a.last = d.donated_at;
    if (d.is_recurring && d.donated_at >= yearAgo) { a.recurring = true; recurringDonors.add(d.contact_id); }
    agg.set(d.contact_id, a);
    if (d.donated_at >= yearStart && d.donated_at <= today) {
      if (d.currency === "ILS") yearSum += Number(d.amount);
      yearCount++;
      yearDonors.add(d.contact_id);
    }
  }
  const ids = [...new Set([...agg.keys(), ...tagged.rows.map((t) => t.contact_id)])];

  const people = (await Promise.all(
    chunk(ids, 150).map((c) =>
      supabase.from("contacts").select("id,full_name,phone,owner_id,campaign_consent,is_demo,merged_into,archived_at").in("id", c).returns<Person[]>()),
  )).flatMap((r) => r.data ?? []);

  const all: Donor[] = people
    .filter((p) => !p.merged_into)
    .map((p) => ({ ...p, ...(agg.get(p.id) ?? blank()) }));

  // filters
  const q = (sp.q ?? "").trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  let rows = all.filter((d) => {
    if (q && !(d.full_name.toLowerCase().includes(q) || (digits.length >= 3 && d.phone && ("0" + d.phone.slice(4)).includes(digits)))) return false;
    if (sp.lapsed && !(d.last && d.last < yearAgo)) return false;
    if (sp.recurring && !d.recurring) return false;
    if (sp.consent === "yes" && d.campaign_consent !== true) return false;
    if (sp.consent === "unknown" && d.campaign_consent !== null) return false;
    return true;
  });
  const sort = sp.sort === "last" || sp.sort === "name" ? sp.sort : "total";
  rows = [...rows].sort((a, b) =>
    sort === "name" ? a.full_name.localeCompare(b.full_name, "he")
      : sort === "last" ? (b.last ?? "").localeCompare(a.last ?? "") || b.total - a.total
        : b.total - a.total || (b.last ?? "").localeCompare(a.last ?? ""));

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const qs = (p: number) => { const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); u.set("page", String(p)); return `?${u}`; };
  const filtersActive = ["q", "lapsed", "recurring", "consent"].some((k) => sp[k]);
  const lapsedCount = all.filter((d) => d.last && d.last < yearAgo).length;
  const loadError = donations.error || tagged.error;
  const truncated = donations.truncated || tagged.truncated;

  return (
    <>
      <PageHeader
        title="תורמים"
        description="מי תומך בעמותה, כמה ומתי. פנייה לתרומה בוואטסאפ או ב-SMS רק למי שהסכים/ה לכך."
        actions={
          <>
            <LinkButton href="/contacts/import" variant="ghost" size="sm">ייבוא ממערכת התרומות</LinkButton>
            <AddDonationDialog campaigns={campaigns.data ?? []} today={today} />
          </>
        }
      />
      <DonorsTabs current="/donors" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label={`נתרם ב-${today.slice(0, 4)}`} value={ils(yearSum)} hint="בשקלים, מתחילת השנה" />
        <Stat label="תרומות השנה" value={yearCount.toLocaleString("he-IL")} href={`/donors/donations?from=${yearStart}`} />
        <Stat label="תורמים השנה" value={yearDonors.size.toLocaleString("he-IL")} hint="אנשים שונים" />
        <Stat label="בהוראת קבע" value={recurringDonors.size.toLocaleString("he-IL")} hint="תרומה קבועה ב-12 החודשים האחרונים" href="/donors?recurring=1" />
      </div>

      {loadError && <p role="alert" className="text-sm text-danger mb-3">חלק מהנתונים לא נטענו, ולכן הסכומים עלולים להיות חסרים. רעננו את הדף.</p>}
      {truncated && <div className="mb-4"><Notice tone="warn">יש יותר מ-50,000 רשומות; הסכומים מחושבים על החלק הראשון בלבד.</Notice></div>}

      <AutoSubmitForm className="flex flex-wrap items-center gap-2 mb-4">
        <Input type="search" name="q" defaultValue={sp.q} placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש תורם/ת" className="w-full sm:w-56 h-9" />
        <Select name="sort" defaultValue={sort === "total" ? "" : sort} aria-label="מיון" className="w-auto h-9">
          <option value="">לפי סכום כולל</option>
          <option value="last">לפי התרומה האחרונה</option>
          <option value="name">לפי שם</option>
        </Select>
        <Select name="consent" defaultValue={sp.consent ?? ""} aria-label="הסכמה לפניות" className="w-auto h-9">
          <option value="">כל ההסכמות</option>
          <option value="yes">הסכימו לפניות</option>
          <option value="unknown">הסכמה לא ידועה</option>
        </Select>
        <label className="inline-flex items-center gap-2 text-sm h-9 px-2 cursor-pointer">
          <input type="checkbox" name="lapsed" value="1" defaultChecked={!!sp.lapsed} className="size-4 accent-[var(--color-brand)]" />
          לא תרמו מעל שנה{lapsedCount > 0 && <span className="text-ink-3 tabular-nums">({lapsedCount})</span>}
        </label>
        <label className="inline-flex items-center gap-2 text-sm h-9 px-2 cursor-pointer">
          <input type="checkbox" name="recurring" value="1" defaultChecked={!!sp.recurring} className="size-4 accent-[var(--color-brand)]" /> הוראת קבע
        </label>
        <noscript><button className={buttonClass("secondary", "sm")}>סינון</button></noscript>
        {filtersActive && <Link href="/donors" className="text-sm text-brand hover:underline px-1">ניקוי</Link>}
      </AutoSubmitForm>

      <Card>
        {shown.length === 0 ? (
          filtersActive ? (
            <EmptyState title="אין תורמים שמתאימים לסינון" action={<LinkButton href="/donors" size="sm">ניקוי הסינון</LinkButton>}>נסו חלק מהשם, או הסירו את אחד הסינונים.</EmptyState>
          ) : (
            <EmptyState title="עדיין אין תורמים" action={<LinkButton href="/contacts/import" variant="primary" size="sm">ייבוא ממערכת התרומות</LinkButton>}>
              מייבאים את קובץ התרומות מהמערכת הקיימת, או רושמים תרומה ידנית בכפתור &quot;רישום תרומה&quot;. כל מי שתורם/ת מסומן/ת אוטומטית כתורם/ת.
            </EmptyState>
          )
        ) : (
          <>
            <div className="px-5 py-3 border-b border-line text-[13px] text-ink-3">{rows.length.toLocaleString("he-IL")} תורמים</div>
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">רשימת תורמים</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 px-3 ps-5">שם</th>
                  <th scope="col" className="text-end font-medium px-3" aria-sort={sort === "total" ? "descending" : undefined}>סך הכול</th>
                  <th scope="col" className="text-start font-medium px-3" aria-sort={sort === "last" ? "descending" : undefined}>תרומה אחרונה</th>
                  <th scope="col" className="text-start font-medium px-3">הסכמה לפניות</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">אחראי/ת</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((d) => {
                  const lapsed = d.last && d.last < yearAgo;
                  return (
                    <tr key={d.id} className="hover:bg-canvas">
                      <td className="py-3 px-3 ps-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/contacts/${d.id}`} className="font-medium text-ink hover:text-brand hover:underline">{d.full_name}</Link>
                          {d.recurring && <Badge tone="info"><Repeat className="size-3.5" aria-hidden />הוראת קבע</Badge>}
                          {d.archived_at && <Badge>בארכיון</Badge>}
                          {d.is_demo && <DemoTag />}
                        </div>
                      </td>
                      <td className="px-3 text-end tabular-nums">
                        <div className="font-medium text-ink">{d.count ? ils(d.total) : <span className="text-ink-3 font-normal">—</span>}</div>
                        <div className="text-[12px] text-ink-3">{d.count === 0 ? "אין תרומות מתועדות" : d.count === 1 ? "תרומה אחת" : `${d.count} תרומות`}{d.otherCurrency ? " · יש גם במט״ח" : ""}</div>
                      </td>
                      <td className="px-3">
                        {d.last ? (
                          <>
                            <div className={cx(lapsed ? "text-warn" : "text-ink-2")}>{formatDate(d.last)}</div>
                            <div className="text-[12px] text-ink-3">{relativeDay(d.last)}{lapsed ? " · מעל שנה" : ""}</div>
                          </>
                        ) : <span className="text-ink-3">—</span>}
                      </td>
                      <td className="px-3"><ConsentBadge consent={d.campaign_consent} /></td>
                      <td className="px-3 pe-5 text-ink-2">{d.owner_id ? lookups.staffName(d.owner_id) : <span className="text-ink-3">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-line">
              {shown.map((d) => (
                <li key={d.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/contacts/${d.id}`} className="font-medium text-ink hover:text-brand hover:underline">{d.full_name}</Link>
                        {d.is_demo && <DemoTag />}
                      </div>
                      <div className="text-[12px] text-ink-3 mt-0.5">
                        {d.last ? `אחרונה: ${formatDate(d.last)} (${relativeDay(d.last)})` : "אין תרומות מתועדות"}
                        {d.owner_id ? ` · ${lookups.staffName(d.owner_id)}` : ""}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="font-semibold tabular-nums">{d.count ? ils(d.total) : "—"}</div>
                      <div className="text-[12px] text-ink-3">{d.count ? `${d.count} תרומות` : ""}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <ConsentBadge consent={d.campaign_consent} />
                    {d.recurring && <Badge tone="info"><Repeat className="size-3.5" aria-hidden />הוראת קבע</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {pages > 1 && (
        <nav aria-label="דפים" className="flex items-center justify-between mt-4 text-sm">
          {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={qs(page - 1)}>→ הקודם</Link> : <span />}
          <span className="text-ink-3">עמוד {page} מתוך {pages}</span>
          {page < pages ? <Link className={buttonClass("secondary", "sm")} href={qs(page + 1)}>הבא ←</Link> : <span />}
        </nav>
      )}

      <p className="text-[12px] text-ink-3 mt-6 max-w-2xl">
        הודעות תפעוליות (למשל אימות פרטים או קבלה) לא דורשות הסכמה. פנייה לתרומה או לקמפיין בוואטסאפ או ב-SMS מותרת רק למי שהסכים/ה מראש (חוק התקשורת, סעיף 30א). את ההסכמה מעדכנים בכרטיס האדם.
      </p>
    </>
  );
}

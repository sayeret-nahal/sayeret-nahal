import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat, Upload } from "lucide-react";
import { Badge, Card, DemoTag, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { AddDonationDialog } from "@/components/donors/dialogs";
import { DonorsTabs } from "@/components/donors/parts";
import { ils, money } from "@/components/donors/format";
import { fetchAll } from "@/components/donors/queries";
import { requireStaff } from "@/lib/auth";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayIL } from "@/lib/dates";
import type { Campaign } from "@/lib/types";

export const metadata: Metadata = { title: "תרומות" };

const PAGE = 50;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Row = {
  id: string; contact_id: string; amount: number; currency: string; donated_at: string; method: string | null; campaign_id: number | null;
  is_recurring: boolean; external_ref: string | null; notes: string | null; is_demo: boolean;
  contacts: { full_name: string; is_demo: boolean } | null;
};

export default async function DonationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  if (!perms.manageDonors(staff.role)) redirect("/");
  const supabase = await createClient();
  const today = todayIL();
  const from = sp.from && ISO.test(sp.from) ? sp.from : null;
  const to = sp.to && ISO.test(sp.to) ? sp.to : null;
  const campaign = sp.campaign === "none" ? "none" : sp.campaign && /^\d+$/.test(sp.campaign) ? Number(sp.campaign) : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  // the same filters apply to the page of rows and to the totals
  let listQ = supabase.from("donations").select("*, contacts(full_name, is_demo)", { count: "exact" });
  if (from) listQ = listQ.gte("donated_at", from);
  if (to) listQ = listQ.lte("donated_at", to);
  if (campaign === "none") listQ = listQ.is("campaign_id", null);
  else if (campaign !== null) listQ = listQ.eq("campaign_id", campaign);

  const totalsPage = (a: number, b: number) => {
    let q = supabase.from("donations").select("amount,currency");
    if (from) q = q.gte("donated_at", from);
    if (to) q = q.lte("donated_at", to);
    if (campaign === "none") q = q.is("campaign_id", null);
    else if (campaign !== null) q = q.eq("campaign_id", campaign);
    return q.order("id").range(a, b);
  };

  const [campaignsRes, list, totals] = await Promise.all([
    supabase.from("campaigns").select("*").order("name").returns<Campaign[]>(),
    listQ
      .order("donated_at", { ascending: false }).order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1)
      .returns<Row[]>(),
    fetchAll<{ amount: number; currency: string }>(totalsPage),
  ]);
  const campaigns = campaignsRes.data ?? [];
  const campaignName = (id: number | null) => campaigns.find((c) => c.id === id)?.name ?? "";
  const rows = list.data ?? [];
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const sumILS = totals.rows.filter((r) => r.currency === "ILS").reduce((s, r) => s + Number(r.amount), 0);
  const foreign = totals.rows.some((r) => r.currency !== "ILS");
  const filtersActive = !!(from || to || campaign !== null);
  const qs = (p: number) => { const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); u.set("page", String(p)); return `?${u}`; };

  return (
    <>
      <PageHeader
        title="תרומות"
        description="כל התרומות שנרשמו, מהחדשה לישנה."
        actions={
          <>
            {perms.importData(staff.role) && (
              <LinkButton href="/contacts/import" variant="secondary" size="sm"><Upload className="size-4" aria-hidden />ייבוא מקובץ</LinkButton>
            )}
            <AddDonationDialog campaigns={campaigns} today={today} defaultCampaign={typeof campaign === "number" ? campaign : undefined} />
          </>
        }
      />
      <DonorsTabs current="/donors/donations" />

      <p className="text-[13px] text-ink-2 mb-4">
        יש קובץ ממערכת התרומות? <Link href="/contacts/import" className="text-brand hover:underline">ייבוא מקובץ</Link> מוסיף את כל התרומות בבת אחת, מזהה תורמים קיימים ומדלג על תרומות שכבר נרשמו (לפי מספר האסמכתה).
      </p>

      <AutoSubmitForm className="flex flex-wrap items-end gap-2 mb-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-[12px] text-ink-3">מתאריך</label>
          <Input id="f-from" type="date" name="from" defaultValue={from ?? ""} max={to ?? undefined} className="w-auto h-9" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className="text-[12px] text-ink-3">עד תאריך</label>
          <Input id="f-to" type="date" name="to" defaultValue={to ?? ""} min={from ?? undefined} className="w-auto h-9" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-campaign" className="text-[12px] text-ink-3">קמפיין</label>
          <Select id="f-campaign" name="campaign" defaultValue={sp.campaign ?? ""} className="w-auto h-9">
            <option value="">כל הקמפיינים</option>
            <option value="none">ללא קמפיין</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <noscript><button className={buttonClass("secondary", "sm")}>סינון</button></noscript>
        {filtersActive && <Link href="/donors/donations" className="text-sm text-brand hover:underline h-9 inline-flex items-center px-1">ניקוי</Link>}
      </AutoSubmitForm>

      {(list.error || totals.error) && <p role="alert" className="text-sm text-danger mb-3">טעינת התרומות נכשלה. רעננו את הדף.</p>}

      <Card>
        {rows.length === 0 ? (
          filtersActive ? (
            <EmptyState title="אין תרומות בטווח הזה" action={<LinkButton href="/donors/donations" size="sm">ניקוי הסינון</LinkButton>}>נסו טווח תאריכים רחב יותר או קמפיין אחר.</EmptyState>
          ) : (
            <EmptyState title="עדיין לא נרשמו תרומות" action={<LinkButton href="/contacts/import" variant="primary" size="sm">ייבוא מקובץ</LinkButton>}>
              הדרך המהירה להתחיל: לייבא את הייצוא ממערכת התרומות. אפשר גם לרשום תרומה בודדת בכפתור &quot;רישום תרומה&quot;.
            </EmptyState>
          )
        ) : (
          <>
            <div className="px-5 py-3 border-b border-line text-sm flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="font-semibold tabular-nums">{ils(sumILS)}</span> <span className="text-ink-3">{filtersActive ? "בטווח שנבחר" : "סך הכול"}</span></span>
              <span className="text-ink-3">{total.toLocaleString("he-IL")} תרומות{foreign ? " · תרומות במט״ח לא כלולות בסכום" : ""}{totals.truncated ? " · הסכום חלקי (יותר מ-50,000 תרומות)" : ""}</span>
            </div>
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">רשימת תרומות</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 px-3 ps-5">תאריך</th>
                  <th scope="col" className="text-start font-medium px-3">תורם/ת</th>
                  <th scope="col" className="text-end font-medium px-3">סכום</th>
                  <th scope="col" className="text-start font-medium px-3">אמצעי</th>
                  <th scope="col" className="text-start font-medium px-3">קמפיין</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">אסמכתה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-canvas align-top">
                    <td className="py-3 px-3 ps-5 text-ink-2 whitespace-nowrap">{formatDate(d.donated_at)}</td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {d.contacts ? (
                          <Link href={`/contacts/${d.contact_id}`} className="font-medium text-ink hover:text-brand hover:underline">{d.contacts.full_name}</Link>
                        ) : <span className="text-ink-3">אין הרשאה לצפייה</span>}
                        {d.is_recurring && <Badge tone="info"><Repeat className="size-3.5" aria-hidden />הוראת קבע</Badge>}
                        {d.is_demo && <DemoTag />}
                      </div>
                      {d.notes && <p className="text-[12px] text-ink-3 mt-0.5 line-clamp-1" title={d.notes}>{d.notes}</p>}
                    </td>
                    <td className="py-3 px-3 text-end font-medium tabular-nums whitespace-nowrap">{money(d.amount, d.currency)}</td>
                    <td className="py-3 px-3 text-ink-2">{d.method ?? <span className="text-ink-3">—</span>}</td>
                    <td className="py-3 px-3 text-ink-2">{d.campaign_id ? campaignName(d.campaign_id) : <span className="text-ink-3">—</span>}</td>
                    <td className="py-3 px-3 pe-5 text-ink-3 text-[13px]" dir="ltr" style={{ textAlign: "end" }}>{d.external_ref ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {d.contacts ? (
                        <Link href={`/contacts/${d.contact_id}`} className="font-medium text-ink hover:text-brand hover:underline">{d.contacts.full_name}</Link>
                      ) : <span className="text-ink-3">אין הרשאה לצפייה</span>}
                      {d.is_demo && <DemoTag />}
                    </div>
                    <div className="text-[12px] text-ink-3 mt-0.5">
                      {[formatDate(d.donated_at), d.method, d.campaign_id ? campaignName(d.campaign_id) : null, d.is_recurring ? "הוראת קבע" : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="font-semibold tabular-nums shrink-0">{money(d.amount, d.currency)}</div>
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
    </>
  );
}

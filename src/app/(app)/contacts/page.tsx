import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DemoTag, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { BulkBar } from "@/components/contacts/bulk-bar";
import { CareBadge } from "@/components/contacts/status";
import { requireStaff } from "@/lib/auth";
import { getLookups, logAccess } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { addDays, daysFromToday, relativeDay, todayIL } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import { PINK_TYPE, activePayerCutoff, pinkState } from "@/lib/pink";

export const metadata: Metadata = { title: "אנשים" };

const PAGE = 50;
const HEALTH: Record<string, string> = {
  missing_phone: "חסר טלפון",
  missing_cohort: "חסר מחזור",
  missing_region: "חסר אזור",
  no_owner: "ללא אחראי",
  not_verified: "לא אומת מעל שנה",
  phone_invalid: "טלפון לא תקין",
  unreachable: "3 ניסיונות ללא מענה",
};

type Row = {
  id: string; full_name: string; phone: string | null; city: string | null; cohort_id: number | null; region_id: number | null;
  owner_id: string | null; is_demo: boolean; last_paid_at: string | null;
  contact_care: { status_code: string; next_contact_at: string | null; last_contact_at: string | null } | null;
  contact_type_links: { type_code: string }[];
};

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff, userId } = await requireStaff();
  const role = staff.role;
  const lookups = await getLookups();
  const supabase = await createClient();
  const seeCare = perms.seeCare(role);
  const page = Math.max(1, Number(sp.page ?? 1));
  const today = todayIL();

  const careSel = seeCare ? (sp.status || sp.due ? "contact_care!inner(status_code,next_contact_at,last_contact_at)" : "contact_care(status_code,next_contact_at,last_contact_at)") : "";
  const typeFilter = sp.pink ? PINK_TYPE : sp.type;
  const typeSel = typeFilter ? "contact_type_links!inner(type_code)" : "contact_type_links(type_code)";
  const select = ["id,full_name,phone,city,cohort_id,region_id,owner_id,is_demo,last_paid_at", careSel, typeSel].filter(Boolean).join(",");
  const payerCutoff = await activePayerCutoff(supabase);

  let q = supabase.from("contacts").select(select, { count: "exact" }).is("merged_into", null);
  q = sp.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);

  let searchIds: string[] | null = null;
  if (sp.q && sp.q.trim().length >= 2) {
    const { data } = await supabase.rpc("search_contacts", { p_q: sp.q, p_limit: 100 });
    const found = (data ?? []).map((r: { id: string }) => r.id);
    searchIds = found;
    q = q.in("id", found.length ? found : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (sp.cohort) q = q.eq("cohort_id", Number(sp.cohort));
  if (sp.region) q = q.eq("region_id", Number(sp.region));
  if (typeFilter) q = q.eq("contact_type_links.type_code", typeFilter);
  if (sp.pink) q = q.or(`last_paid_at.is.null,last_paid_at.lt.${payerCutoff}`);
  if (sp.owner === "me") q = q.eq("owner_id", userId);
  else if (sp.owner === "none") q = q.is("owner_id", null);
  else if (sp.owner) q = q.eq("owner_id", sp.owner);
  if (seeCare && sp.status) q = q.eq("contact_care.status_code", sp.status);
  if (seeCare && sp.due) q = q.lte("contact_care.next_contact_at", today);
  switch (sp.health) {
    case "missing_phone": q = q.is("phone", null); break;
    case "missing_cohort": q = q.is("cohort_id", null); break;
    case "missing_region": q = q.is("region_id", null); break;
    case "no_owner": q = q.is("owner_id", null); break;
    case "phone_invalid": q = q.eq("phone_status", "invalid"); break;
    case "not_verified": q = q.or(`verified_at.is.null,verified_at.lt.${addDays(today, -365)}`); break;
    case "unreachable": {
      const { data } = await supabase.from("contact_health").select("contact_id").eq("unreachable", true).limit(500);
      q = q.in("id", (data ?? []).map((r) => r.contact_id as string).concat("00000000-0000-0000-0000-000000000000"));
      break;
    }
  }
  q = sp.sort === "next" && seeCare
    ? q.order("next_contact_at", { referencedTable: "contact_care", ascending: true }).order("full_name")
    : q.order("full_name");
  const { data, count, error } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  await logAccess("view", "contacts_list", null, { filters: Object.keys(sp).filter((k) => sp[k]), rows: data?.length ?? 0, page });
  let rows = (data ?? []) as unknown as Row[];
  if (searchIds && !sp.sort) rows = [...rows].sort((a, b) => searchIds!.indexOf(a.id) - searchIds!.indexOf(b.id));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => { const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); u.set("page", String(p)); return `?${u}`; };
  const filtersActive = ["q", "cohort", "region", "type", "status", "owner", "health", "due", "archived", "pink"].some((k) => sp[k]);
  // Type links come back filtered when a type filter is on, so the pink column is only exact without one.
  const pinkOf = (r: Row) => pinkState(typeFilter && typeFilter !== PINK_TYPE ? [] : r.contact_type_links.map((t) => t.type_code), r.last_paid_at, payerCutoff);
  const canBulk = perms.bulkEdit(role);

  return (
    <>
      <PageHeader
        title="אנשים"
        description={`${total.toLocaleString("he-IL")} ${filtersActive ? "תוצאות" : "אנשים בקהילה"}`}
        actions={
          <>
            {perms.reviewDuplicates(role) && <LinkButton href="/contacts/quality" variant="ghost" size="sm">איכות נתונים</LinkButton>}
            {perms.importData(role) && <LinkButton href="/contacts/import" variant="secondary" size="sm">ייבוא מקובץ</LinkButton>}
            {perms.createContacts(role) && <LinkButton href="/contacts/new" variant="primary" size="sm">הוספת אדם</LinkButton>}
          </>
        }
      />

      <AutoSubmitForm className="flex flex-wrap gap-2 mb-4">
        <Input type="search" name="q" defaultValue={sp.q} placeholder="חיפוש…" aria-label="חיפוש" className="w-full sm:w-56 h-9" />
        <Select name="cohort" defaultValue={sp.cohort ?? ""} aria-label="מחזור" className="w-auto h-9">
          <option value="">כל המחזורים</option>
          {lookups.cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select name="region" defaultValue={sp.region ?? ""} aria-label="אזור" className="w-auto h-9">
          <option value="">כל האזורים</option>
          {lookups.regions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select name="type" defaultValue={sp.type ?? ""} aria-label="סוג קשר" className="w-auto h-9">
          <option value="">כל הסוגים</option>
          {lookups.types.filter((t) => seeCare || !t.is_sensitive).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </Select>
        {seeCare && (
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="מצב קשר" className="w-auto h-9">
            <option value="">כל המצבים</option>
            {lookups.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
        )}
        <Select name="owner" defaultValue={sp.owner ?? ""} aria-label="אחראי/ת" className="w-auto h-9">
          <option value="">כל האחראים</option>
          <option value="me">באחריותי</option>
          <option value="none">ללא אחראי</option>
          {lookups.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
        <Select name="health" defaultValue={sp.health ?? ""} aria-label="איכות נתונים" className="w-auto h-9">
          <option value="">כל הרשומות</option>
          {Object.entries(HEALTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {seeCare && (
          <Select name="sort" defaultValue={sp.sort ?? ""} aria-label="מיון" className="w-auto h-9">
            <option value="">מיון לפי שם</option>
            <option value="next">מיון לפי השיחה הבאה</option>
          </Select>
        )}
        <label className="inline-flex items-center gap-2 text-sm h-9 px-2">
          <input type="checkbox" name="pink" value="1" defaultChecked={!!sp.pink} className="accent-[var(--color-pink)]" /> הרשימה הורודה
        </label>
        {seeCare && (
          <label className="inline-flex items-center gap-2 text-sm h-9 px-2">
            <input type="checkbox" name="due" value="1" defaultChecked={!!sp.due} className="accent-[var(--color-brand)]" /> הגיע זמן לשיחה
          </label>
        )}
        <noscript><button className={buttonClass("secondary", "sm")}>סינון</button></noscript>
        {filtersActive && <Link href="/contacts" className="text-sm text-brand self-center hover:underline">ניקוי</Link>}
      </AutoSubmitForm>

      {error && <p role="alert" className="text-sm text-danger mb-3">טעינת הרשימה נכשלה. רעננו את הדף.</p>}

      <Card>
        {rows.length === 0 ? (
          filtersActive ? (
            <EmptyState title="אין תוצאות" action={<LinkButton href="/contacts" size="sm">ניקוי הסינון</LinkButton>}>נסו לשנות את הסינון או לחפש לפי חלק מהשם או מהטלפון.</EmptyState>
          ) : (
            <EmptyState title="עדיין אין אנשים במערכת" action={perms.importData(role) ? <LinkButton href="/contacts/import" variant="primary" size="sm">ייבוא מאקסל</LinkButton> : undefined}>
              הדרך המהירה להתחיל: לייבא את קובצי האקסל הקיימים. המערכת תזהה כפילויות לפני השמירה.
            </EmptyState>
          )
        ) : (
          <>
            {/* desktop table */}
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">רשימת אנשים</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  {canBulk && <th className="w-10 ps-5"><span className="sr-only">בחירה</span></th>}
                  <th className="text-start font-medium py-2.5 px-3">שם</th>
                  <th className="text-start font-medium px-3">מחזור</th>
                  <th className="text-start font-medium px-3">מגורים</th>
                  <th className="text-start font-medium px-3">הרשימה הורודה</th>
                  {seeCare && <th className="text-start font-medium px-3">מצב</th>}
                  <th className="text-start font-medium px-3">אחראי/ת</th>
                  {seeCare && <th className="text-start font-medium px-3">שיחה הבאה</th>}
                  <th className="text-start font-medium px-3 pe-5">טלפון</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const next = r.contact_care?.next_contact_at;
                  return (
                    <tr key={r.id} className="hover:bg-canvas">
                      {canBulk && <td className="ps-5"><input type="checkbox" name="ids" value={r.id} form="bulk-form" aria-label={`בחירת ${r.full_name}`} className="accent-[var(--color-brand)]" /></td>}
                      <td className="py-2.5 px-3">
                        <Link href={`/contacts/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline">{r.full_name}</Link>
                        {r.is_demo && <span className="ms-2"><DemoTag /></span>}
                        <div className="text-[12px] text-ink-3">{r.contact_type_links.filter((t) => t.type_code !== PINK_TYPE).map((t) => lookups.typeLabel(t.type_code)).join(" · ")}</div>
                      </td>
                      <td className="px-3 text-ink-2">{lookups.cohortLabel(r.cohort_id)}</td>
                      <td className="px-3 text-ink-2">{r.city ?? lookups.regionLabel(r.region_id)}</td>
                      <td className="px-3"><PinkCell state={pinkOf(r)} /></td>
                      {seeCare && <td className="px-3"><CareBadge status={lookups.status(r.contact_care?.status_code)} /></td>}
                      <td className="px-3 text-ink-2">{r.owner_id ? lookups.staffName(r.owner_id) : <span className="text-ink-3">—</span>}</td>
                      {seeCare && <td className={cx("px-3", next && daysFromToday(next) <= 0 ? "text-danger font-medium" : "text-ink-2")}>{relativeDay(next)}</td>}
                      <td className="px-3 pe-5 text-ink-2" dir="ltr" style={{ textAlign: "end" }}>{displayPhone(r.phone)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* mobile cards */}
            <ul className="md:hidden divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/contacts/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2">{r.full_name}{pinkOf(r) === "on" && <Badge tone="pink">הרשימה הורודה</Badge>}{r.is_demo && <DemoTag />}</div>
                      <div className="text-[12px] text-ink-3 truncate">{[lookups.cohortLabel(r.cohort_id), r.city ?? lookups.regionLabel(r.region_id)].filter(Boolean).join(" · ")}</div>
                    </div>
                    {seeCare && <CareBadge status={lookups.status(r.contact_care?.status_code)} />}
                  </Link>
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

      {canBulk && <BulkBar staff={lookups.staff} cohorts={lookups.cohorts} regions={lookups.regions} types={lookups.types} statuses={lookups.statuses} canSeeCare={seeCare} />}
    </>
  );
}

function PinkCell({ state }: { state: ReturnType<typeof pinkState> }) {
  if (state === "on") return <Badge tone="pink">ברשימה</Badge>;
  if (state === "paying") return <span className="text-[12px] text-ink-3" title="נהנה/ית משירותי העמותה, ושילם/ה לאחרונה">משלם/ת פעיל/ה</span>;
  return <span className="text-ink-3">—</span>;
}

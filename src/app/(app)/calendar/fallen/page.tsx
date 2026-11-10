import type { Metadata } from "next";
import Link from "next/link";
import { Card, DemoTag, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { FallenDialog } from "@/components/calendar/dialogs";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { daysFromToday, formatDate, hebrewDate, memorialDates, relativeDay, todayIL } from "@/lib/dates";
import type { Fallen } from "@/lib/types";

export const metadata: Metadata = { title: "חללי היחידה" };

export default async function FallenListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const role = staff.role;
  const lookups = await getLookups();
  const supabase = await createClient();
  const today = todayIL();
  const canManage = perms.manageMemorials(role);

  const { data, error } = await supabase.from("fallen").select("*").order("last_name").order("first_name").returns<Fallen[]>();
  const all = (data ?? []).map((f) => ({ f, m: memorialDates(f.death_date, f.after_sunset, today) }));

  const q = (sp.q ?? "").trim().toLowerCase();
  let rows = all.filter(({ f }) =>
    (!q || `${f.first_name} ${f.last_name} ${f.residence ?? ""}`.toLowerCase().includes(q)) &&
    (!sp.cohort || f.cohort_id === Number(sp.cohort)) &&
    (!sp.war || f.war_operation === sp.war),
  );
  const wars = [...new Set(all.map(({ f }) => f.war_operation).filter((w): w is string => !!w))].sort((a, b) => a.localeCompare(b, "he"));
  if (sp.sort === "date") rows = [...rows].sort((a, b) => (a.f.death_date < b.f.death_date ? 1 : -1));
  else if (sp.sort !== "name") rows = [...rows].sort((a, b) => (a.m.nextAzkara < b.m.nextAzkara ? -1 : a.m.nextAzkara > b.m.nextAzkara ? 1 : 0));
  const filtersActive = !!(sp.q || sp.cohort || sp.sort || sp.war);

  return (
    <>
      <PageHeader
        back={{ href: "/calendar", label: "תאריכים ואירועים" }}
        title="חללי היחידה"
        description="יהי זכרם ברוך. מכל תאריך נפילה המערכת מחשבת את יום האזכרה לפי הלוח העברי ואת יום השנה לפי הלוח הלועזי."
        actions={canManage ? <FallenDialog cohorts={lookups.cohorts} staff={lookups.staff} maxDate={today} /> : undefined}
      />

      {all.length > 0 && (
        <AutoSubmitForm className="flex flex-wrap gap-2 mb-4">
          <Input type="search" name="q" defaultValue={sp.q} placeholder="חיפוש לפי שם או יישוב…" aria-label="חיפוש לפי שם או יישוב" className="w-full sm:w-56 h-9" />
          <Select name="cohort" defaultValue={sp.cohort ?? ""} aria-label="מחזור" className="w-auto h-9">
            <option value="">כל המחזורים</option>
            {lookups.cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          {wars.length > 0 && (
            <Select name="war" defaultValue={sp.war ?? ""} aria-label="מלחמה או מבצע" className="w-auto h-9 max-w-64">
              <option value="">כל המלחמות והמבצעים</option>
              {wars.map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          )}
          <Select name="sort" defaultValue={sp.sort ?? ""} aria-label="מיון" className="w-auto h-9">
            <option value="">לפי יום האזכרה הקרוב</option>
            <option value="name">לפי שם משפחה</option>
            <option value="date">לפי תאריך הנפילה</option>
          </Select>
          <noscript><button className={buttonClass("secondary", "sm")}>סינון</button></noscript>
          {filtersActive && <Link href="/calendar/fallen" className="text-sm text-brand self-center hover:underline">ניקוי</Link>}
        </AutoSubmitForm>
      )}

      {error && <p role="alert" className="text-sm text-danger mb-3">טעינת הרשימה נכשלה. רעננו את הדף.</p>}

      <Card>
        {rows.length === 0 ? (
          all.length === 0 ? (
            <EmptyState title="הרשימה עדיין ריקה">
              {canManage
                ? "הוסיפו כל חלל/ה עם תאריך הנפילה. ימי האזכרה יופיעו אוטומטית בלוח התאריכים, עם אפשרות ליצור משימת קשר עם המשפחה."
                : "רכזי הקהילה וההנהלה מעדכנים את הרשימה. ימי האזכרה יופיעו אוטומטית בלוח התאריכים."}
            </EmptyState>
          ) : (
            <EmptyState title="אין תוצאות" action={<LinkButton href="/calendar/fallen" size="sm">ניקוי הסינון</LinkButton>}>נסו חלק מהשם או מחזור אחר.</EmptyState>
          )
        ) : (
          <>
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">רשימת חללי היחידה</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 px-3 ps-5">שם</th>
                  <th scope="col" className="text-start font-medium px-3">גיוס</th>
                  <th scope="col" className="text-start font-medium px-3">מגורים וקבורה</th>
                  <th scope="col" className="text-start font-medium px-3">מלחמה / מבצע</th>
                  <th scope="col" className="text-start font-medium px-3">תאריך הנפילה</th>
                  <th scope="col" className="text-start font-medium px-3">יום האזכרה הבא</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">אחראי/ת</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ f, m }) => {
                  const soon = daysFromToday(m.nextAzkara) <= 14;
                  return (
                    <tr key={f.id} className="hover:bg-canvas">
                      <td className="py-3 px-3 ps-5">
                        <Link href={`/calendar/fallen/${f.id}`} className="font-medium text-ink hover:text-brand hover:underline">{f.first_name} {f.last_name} ז״ל</Link>
                        {f.is_demo && <span className="ms-2"><DemoTag /></span>}
                      </td>
                      <td className="px-3 text-ink-2">
                        <div>{lookups.cohortLabel(f.cohort_id) || f.enlistment_text || <span className="text-ink-3">—</span>}</div>
                        {f.sub_unit && <div className="text-[12px] text-ink-3">{f.sub_unit}</div>}
                      </td>
                      <td className="px-3 text-ink-2">
                        <div>{f.residence || <span className="text-ink-3">—</span>}</div>
                        {f.burial_place && <div className="text-[12px] text-ink-3">{f.burial_place}</div>}
                      </td>
                      <td className="px-3 text-ink-2 max-w-48">{f.war_operation || <span className="text-ink-3">—</span>}</td>
                      <td className="px-3 text-ink-2">
                        <div>{formatDate(f.death_date)}</div>
                        <div className="text-[12px] text-ink-3">{hebrewDate(f.death_date, f.after_sunset)}{f.after_sunset ? " (אחרי השקיעה)" : ""}</div>
                      </td>
                      <td className="px-3">
                        <div className={cx(soon ? "text-ink font-medium" : "text-ink-2")}>{formatDate(m.nextAzkara)} · {relativeDay(m.nextAzkara)}</div>
                        <div className="text-[12px] text-ink-3">{m.azkaraHebrew} · {m.years === 1 ? "שנה אחת" : `${m.years} שנים`}</div>
                      </td>
                      <td className="px-3 pe-5 text-ink-2">{f.owner_id ? lookups.staffName(f.owner_id) : <span className="text-warn">ללא</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-line">
              {rows.map(({ f, m }) => (
                <li key={f.id}>
                  <Link href={`/calendar/fallen/${f.id}`} className="block px-4 py-3">
                    <div className="font-medium flex flex-wrap items-center gap-2">{f.first_name} {f.last_name} ז״ל {f.is_demo && <DemoTag />}</div>
                    <div className="text-[12px] text-ink-3 mt-0.5">
                      {[lookups.cohortLabel(f.cohort_id) || f.enlistment_text, f.residence, `נפל/ה ב-${formatDate(f.death_date)}`, f.war_operation].filter(Boolean).join(" · ")}
                    </div>
                    <div className="text-[13px] text-ink-2 mt-1">
                      יום האזכרה: {m.azkaraHebrew} · {formatDate(m.nextAzkara)} ({relativeDay(m.nextAzkara)})
                    </div>
                    <div className="text-[12px] text-ink-3 mt-0.5">אחראי/ת: {f.owner_id ? lookups.staffName(f.owner_id) : "ללא"}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

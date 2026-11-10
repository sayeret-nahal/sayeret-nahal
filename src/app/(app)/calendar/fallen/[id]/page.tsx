import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, DemoTag, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";
import { FallenDialog, FamilyDialog } from "@/components/calendar/dialogs";
import { MemorialTaskButton } from "@/components/calendar/memorial-task-button";
import { weekdayLong } from "@/components/calendar/utils";
import { requireStaff } from "@/lib/auth";
import { getLookups, logAccess } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, hebrewDate, memorialDates, relativeDay, todayIL } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import type { Fallen } from "@/lib/types";
import { removeFamilyMember } from "../../actions";

export const metadata: Metadata = { title: "חלל/ת היחידה" };

type FamilyRow = { contact_id: string; relation: string | null; contacts: { id: string; full_name: string; phone: string | null; is_demo: boolean } | null };

export default async function FallenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { staff } = await requireStaff();
  const role = staff.role;
  const supabase = await createClient();
  const { data: f } = await supabase.from("fallen").select("*").eq("id", id).maybeSingle<Fallen>();
  if (!f) notFound();

  const seeFamily = perms.seeCare(role);
  const canManage = perms.manageMemorials(role);
  const [lookups, family] = await Promise.all([
    getLookups(),
    seeFamily
      ? supabase.from("fallen_family").select("contact_id, relation, contacts(id, full_name, phone, is_demo)").eq("fallen_id", id).returns<FamilyRow[]>()
      : Promise.resolve({ data: [] as FamilyRow[], error: null }),
    logAccess("view", "fallen", id),
  ]);
  // people connected to this fallen soldier: same cohort, or living in the same town (RLS limits who you see)
  const { data: links } = await supabase.from("fallen_connections").select("contact_id, reason").eq("fallen_id", id).limit(2000);
  const reasonsById = new Map<string, Set<string>>();
  for (const l of (links ?? []) as { contact_id: string; reason: string }[]) {
    if (!reasonsById.has(l.contact_id)) reasonsById.set(l.contact_id, new Set());
    reasonsById.get(l.contact_id)!.add(l.reason);
  }
  const connIds = [...reasonsById.keys()].slice(0, 300);
  const { data: connContacts } = connIds.length
    ? await supabase.from("contacts").select("id, full_name, phone, city, is_demo").in("id", connIds).order("full_name")
    : { data: [] };
  const connected = ((connContacts ?? []) as { id: string; full_name: string; phone: string | null; city: string | null; is_demo: boolean }[])
    .map((c) => ({ ...c, reasons: reasonsById.get(c.id)! }))
    .sort((a, b) => b.reasons.size - a.reasons.size || a.full_name.localeCompare(b.full_name, "he"));
  const cohortCount = connected.filter((c) => c.reasons.has("cohort")).length;
  const cityCount = connected.filter((c) => c.reasons.has("city")).length;

  const members = (family.data ?? []).filter((m) => m.contacts).sort((a, b) => a.contacts!.full_name.localeCompare(b.contacts!.full_name, "he"));

  // next three azkara (Hebrew calendar) and anniversary (Gregorian) dates
  const today = todayIL();
  const deathYear = Number(f.death_date.slice(0, 4));
  const rows: { years: number; azkara: string; azkaraHebrew: string; anniversary: string; annYears: number }[] = [];
  let fromA = today;
  let fromG = today;
  for (let i = 0; i < 3; i++) {
    const a = memorialDates(f.death_date, f.after_sunset, fromA);
    const g = memorialDates(f.death_date, f.after_sunset, fromG);
    rows.push({ years: a.years, azkara: a.nextAzkara, azkaraHebrew: a.azkaraHebrew, anniversary: g.nextAnniversary, annYears: Number(g.nextAnniversary.slice(0, 4)) - deathYear });
    fromA = addDays(a.nextAzkara, 1);
    fromG = addDays(g.nextAnniversary, 1);
  }
  const name = `${f.first_name} ${f.last_name}`;

  return (
    <>
      <PageHeader
        back={{ href: "/calendar/fallen", label: "חללי היחידה" }}
        title={<span className="inline-flex flex-wrap items-center gap-2">{name} ז״ל{f.is_demo && <DemoTag />}</span>}
        description={
          <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
            {f.cohort_id && <span>מחזור {lookups.cohortLabel(f.cohort_id)}</span>}
            <span>נפל/ה ב-{formatDate(f.death_date)} · {hebrewDate(f.death_date, f.after_sunset)}{f.after_sunset ? " (אחרי השקיעה)" : ""}</span>
          </span>
        }
        actions={canManage ? <FallenDialog fallen={f} cohorts={lookups.cohorts} staff={lookups.staff} maxDate={today} /> : undefined}
      />

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <Card>
            <CardHeader title="ימי הזיכרון בשנים הקרובות" subtitle="יום האזכרה נקבע לפי התאריך העברי; יום השנה לפי התאריך הלועזי." />
            <table className="hidden sm:table w-full text-sm border-t border-line">
              <caption className="sr-only">ימי אזכרה וימי שנה בשלוש השנים הקרובות</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 px-3 ps-5">יום האזכרה (לפי הלוח העברי)</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">יום השנה (לפי הלוח הלועזי)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.azkara}>
                    <td className="py-3 px-3 ps-5">
                      <div><span className="font-medium">{r.azkaraHebrew}</span> <span className="text-ink-3">· {yearsLabel(r.years)}</span></div>
                      <div className="text-[12px] text-ink-3">{weekdayLong(r.azkara)}, {formatDate(r.azkara)} · {relativeDay(r.azkara)}</div>
                    </td>
                    <td className="py-3 px-3 pe-5">
                      <div><span className="font-medium">{formatDate(r.anniversary)}</span> <span className="text-ink-3">· {yearsLabel(r.annYears)}</span></div>
                      <div className="text-[12px] text-ink-3">{weekdayLong(r.anniversary)} · {relativeDay(r.anniversary)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="sm:hidden divide-y divide-line border-t border-line">
              {rows.map((r) => (
                <li key={r.azkara} className="px-4 py-3 text-sm">
                  <div><span className="text-ink-3">יום האזכרה: </span><span className="font-medium">{r.azkaraHebrew}</span> · {yearsLabel(r.years)}</div>
                  <div className="text-[12px] text-ink-3">{weekdayLong(r.azkara)}, {formatDate(r.azkara)} · {relativeDay(r.azkara)}</div>
                  <div className="mt-1.5"><span className="text-ink-3">יום השנה: </span><span className="font-medium">{formatDate(r.anniversary)}</span> · {yearsLabel(r.annYears)}</div>
                  <div className="text-[12px] text-ink-3">{weekdayLong(r.anniversary)} · {relativeDay(r.anniversary)}</div>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-4 flex flex-wrap items-center gap-3">
              <MemorialTaskButton fallenId={f.id} occasion="azkara" name={name} />
              <p className="text-[12px] text-ink-3">המשימה נקבעת לשבוע לפני יום האזכרה הקרוב, לאחראי/ת על המשפחה.</p>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="בני המשפחה"
              subtitle={seeFamily ? "האנשים שאיתם שומרים על קשר" : undefined}
              action={seeFamily && canManage ? <FamilyDialog fallenId={f.id} /> : undefined}
            />
            {!seeFamily ? (
              <div className="px-5 pb-5"><Notice tone="neutral">פרטי המשפחות מוצגים רק לצוות הקהילה.</Notice></div>
            ) : members.length === 0 ? (
              <EmptyState title="עדיין לא קושרו בני משפחה">
                {canManage
                  ? "קשרו הורים, בני זוג ואחים מתוך רשימת האנשים — כך הם יופיעו ביום האזכרה ובמשימות הקשר."
                  : "רכזי הקהילה וההנהלה יכולים לקשר בני משפחה. ייתכן גם שיש בני משפחה שאין לך הרשאה לראות."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {members.map((m) => (
                  <li key={m.contact_id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/contacts/${m.contact_id}`} className="font-medium text-sm text-ink hover:text-brand hover:underline">{m.contacts!.full_name}</Link>
                        {m.relation && <Badge>{m.relation}</Badge>}
                        {m.contacts!.is_demo && <DemoTag />}
                      </div>
                      {m.contacts!.phone && <div className="text-[12px] text-ink-3 mt-0.5" dir="ltr" style={{ textAlign: "start" }}>{displayPhone(m.contacts!.phone)}</div>}
                    </div>
                    {canManage && (
                      <form action={removeFamilyMember}>
                        <input type="hidden" name="fallen_id" value={f.id} />
                        <input type="hidden" name="contact_id" value={m.contact_id} />
                        <ConfirmSubmit variant="secondary" message={`להסיר את הקישור של ${m.contacts!.full_name} למשפחה של ${name}? הכרטיס של האדם עצמו לא יימחק.`}>
                          הסרה<span className="sr-only"> של {m.contacts!.full_name}</span>
                        </ConfirmSubmit>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader
              title="אנשים שמחוברים אליו/ה"
              subtitle={`${cohortCount} מאותו מחזור · ${cityCount} גרים ב${f.residence ?? "אותו יישוב"}. אפשר לפנות אליהם לקראת יום האזכרה, ולבקש מתושבי היישוב להגיע לנחם כנציגי הסיירת.`}
            />
            {connected.length === 0 ? (
              <EmptyState title="לא נמצאו אנשים מחוברים">
                {f.cohort_id || f.residence ? "אין במערכת אנשים מאותו מחזור או מאותו יישוב שיש לך הרשאה לראות." : "חסרים מחזור ומקום מגורים, ולכן אי אפשר להצליב."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {connected.slice(0, 100).map((c) => (
                  <li key={c.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/contacts/${c.id}`} className="font-medium text-sm text-ink hover:text-brand hover:underline">{c.full_name}</Link>
                        {c.reasons.has("cohort") && <Badge>אותו מחזור</Badge>}
                        {c.reasons.has("city") && <Badge>גר/ה ב{c.city}</Badge>}
                        {c.is_demo && <DemoTag />}
                      </div>
                    </div>
                    {c.phone && <a href={`tel:${c.phone}`} className="text-[12px] text-ink-3 hover:text-brand" dir="ltr">{displayPhone(c.phone)}</a>}
                  </li>
                ))}
                {connected.length > 100 && <li className="px-5 py-2.5 text-[12px] text-ink-3">ועוד {connected.length - 100}…</li>}
              </ul>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader title="פרטים" />
            <dl className="px-5 pb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">אחראי/ת</dt>
              <dd>{f.owner_id ? lookups.staffName(f.owner_id) : <span className="text-warn">אין אחראי/ת — כדאי לקבוע</span>}</dd>
              {f.rank && <><dt className="text-ink-3">דרגה</dt><dd>{f.rank}</dd></>}
              {f.sub_unit && <><dt className="text-ink-3">פלוגה / יחידה</dt><dd>{f.sub_unit}</dd></>}
              <dt className="text-ink-3">מחזור</dt><dd>{lookups.cohortLabel(f.cohort_id) || "לא ידוע"}</dd>
              {f.enlistment_text && <><dt className="text-ink-3">גיוס</dt><dd>{f.enlistment_text}</dd></>}
              <dt className="text-ink-3">מקום מגורים</dt><dd>{f.residence || "לא ידוע"}</dd>
              <dt className="text-ink-3">מקום קבורה</dt><dd>{f.burial_place || "לא ידוע"}</dd>
              {f.war_operation && <><dt className="text-ink-3">מלחמה / מבצע</dt><dd>{f.war_operation}</dd></>}
              <dt className="text-ink-3">תאריך עברי</dt><dd>{hebrewDate(f.death_date, f.after_sunset)}</dd>
              <dt className="text-ink-3">אחרי השקיעה</dt><dd>{f.after_sunset ? "כן" : "לא / לא ידוע"}</dd>
            </dl>
            {f.notes && <p className="px-5 pb-5 pt-3 text-sm text-ink-2 whitespace-pre-line border-t border-line">{f.notes}</p>}
            {(f.source_url || f.source_note) && (
              <div className="px-5 pb-5 pt-3 text-[12px] text-ink-3 border-t border-line">
                {f.source_note && <p className="whitespace-pre-line">{f.source_note}</p>}
                {f.source_url && <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">דף ההנצחה באתר יזכור ↗</a>}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

function yearsLabel(n: number) {
  return n === 1 ? "שנה אחת" : `${n} שנים`;
}

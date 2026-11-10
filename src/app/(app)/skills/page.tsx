import type { Metadata } from "next";
import Link from "next/link";
import { HandHelping, ShieldCheck } from "lucide-react";
import { Badge, Card, DemoTag, EmptyState, Input, LinkButton, Notice, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "מאגר כישורים" };

const LIMIT = 200;

type Row = {
  id: string; full_name: string; profession: string | null; skills: string[]; region_id: number | null; city: string | null;
  cohort_id: number | null; available_to_help: boolean; skills_share_consent: boolean; is_demo: boolean;
};

/** Removes characters that have meaning in PostgREST filter syntax (, . ( ) " \ { } * % :) so free text can't break the `or` filter. */
function cleanTerm(s: string): string {
  return s.replace(/[,.()"\\{}*%:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export default async function SkillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff();
  const lookups = await getLookups();
  const supabase = await createClient();
  const term = cleanTerm(sp.q ?? "");

  const base = () =>
    supabase.from("contacts").select("id,full_name,profession,skills,region_id,city,cohort_id,available_to_help,skills_share_consent,is_demo", { count: "exact" })
      .is("merged_into", null).is("archived_at", null);

  let q = base();
  // One `or` group only: with a search term it already implies "has a profession or skills".
  q = term
    ? q.or(`profession.ilike."*${term}*",skills.cs.{"${term}"}`)
    : q.or("profession.not.is.null,skills.neq.{}");
  if (sp.region) q = q.eq("region_id", Number(sp.region));
  if (sp.help) q = q.eq("available_to_help", true);
  if (sp.consent) q = q.eq("skills_share_consent", true);

  const [res, pool] = await Promise.all([
    q.order("full_name").limit(LIMIT).returns<Row[]>(),
    // for the top-skills chips: everyone with skills this user may see
    supabase.from("contacts").select("skills").is("merged_into", null).is("archived_at", null).neq("skills", "{}").limit(1000).returns<{ skills: string[] }[]>(),
  ]);
  const rows = res.data ?? [];
  const total = res.count ?? rows.length;

  const counts = new Map<string, { label: string; n: number }>();
  for (const r of pool.data ?? []) {
    for (const s of new Set(r.skills.map((x) => x.trim()).filter(Boolean))) {
      const k = s.toLowerCase();
      const cur = counts.get(k);
      if (cur) cur.n++;
      else counts.set(k, { label: s, n: 1 });
    }
  }
  const topSkills = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "he")).slice(0, 20);
  const poolEmpty = (pool.data ?? []).length === 0;

  const filtersActive = !!(sp.q || sp.region || sp.help || sp.consent);
  const chipHref = (skill: string) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "q") as [string, string][]);
    u.set("q", skill);
    return `/skills?${u}`;
  };

  return (
    <>
      <PageHeader
        title="מאגר כישורים"
        description="מי בקהילה יכול לעזור במה: מקצועות, תחומי מומחיות ונכונות לעזור לחברים."
      />

      <div className="mb-5">
        <Notice tone="info" title="לפני שמחברים בין אנשים">
          פרטי הקשר מוצגים רק לצוות, בכרטיס האדם. לפני שמפנים מישהו שזקוק לעזרה, ודאו שהאדם שיכול לעזור הסכים שנפנה אליו — מסומן כאן ב&quot;הסכים/ה שנפנה&quot;. אם אין הסכמה, קודם שואלים אותו/ה.
        </Notice>
      </div>

      <AutoSubmitForm className="flex flex-wrap items-center gap-2 mb-3">
        <Input type="search" name="q" defaultValue={sp.q} placeholder="מקצוע או כישור, למשל: עורך דין" aria-label="חיפוש מקצוע או כישור" className="w-full sm:w-72 h-9" />
        <Select name="region" defaultValue={sp.region ?? ""} aria-label="אזור" className="w-auto h-9">
          <option value="">כל האזורים</option>
          {lookups.regions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm h-9 px-2 cursor-pointer">
          <input type="checkbox" name="help" value="1" defaultChecked={!!sp.help} className="size-4 accent-[var(--color-brand)]" /> רק מי שמוכן/ה לעזור
        </label>
        <label className="inline-flex items-center gap-2 text-sm h-9 px-2 cursor-pointer">
          <input type="checkbox" name="consent" value="1" defaultChecked={!!sp.consent} className="size-4 accent-[var(--color-brand)]" /> רק מי שהסכים/ה שנפנה אליו/ה
        </label>
        <button className={buttonClass("secondary", "sm")}>חיפוש</button>
        {filtersActive && <Link href="/skills" className="text-sm text-brand hover:underline px-1">ניקוי</Link>}
      </AutoSubmitForm>
      <p className="text-[12px] text-ink-3 mb-4">החיפוש מוצא חלק משם המקצוע, או כישור בשמו המלא. אפשר גם ללחוץ על אחד הכישורים הנפוצים.</p>

      {topSkills.length > 0 && (
        <nav aria-label="כישורים נפוצים" className="mb-5">
          <ul className="flex flex-wrap gap-1.5">
            {topSkills.map((s) => {
              const active = term.toLowerCase() === s.label.toLowerCase();
              return (
                <li key={s.label}>
                  <Link
                    href={active ? "/skills" : chipHref(s.label)}
                    aria-current={active ? "true" : undefined}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full border h-8 px-3 text-[13px]",
                      active ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-ink-2 hover:border-brand hover:text-brand",
                    )}
                  >
                    {s.label}
                    <span className={cx("tabular-nums text-[11px]", active ? "text-white/80" : "text-ink-3")}>{s.n}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {res.error && <p role="alert" className="text-sm text-danger mb-3">החיפוש נכשל. נסו שוב או רעננו את הדף.</p>}

      <Card>
        {rows.length === 0 ? (
          filtersActive && !poolEmpty ? (
            <EmptyState title="לא נמצאו אנשים מתאימים" action={<LinkButton href="/skills" size="sm">ניקוי החיפוש</LinkButton>}>
              נסו מילה קצרה יותר (למשל &quot;חשמל&quot; במקום &quot;חשמלאי מוסמך&quot;), אזור אחר, או בלי הסינון של ההסכמה.
            </EmptyState>
          ) : (
            <EmptyState title="המאגר עדיין ריק" action={<LinkButton href="/contacts" size="sm">לרשימת האנשים</LinkButton>}>
              כישורים ומקצועות מתווספים בכרטיס האדם (&quot;עריכת פרטים&quot;), או על ידי האנשים עצמם דרך קישור העדכון העצמי שאפשר לשלוח מהכרטיס שלהם. שם הם גם מסמנים אם הם מוכנים לעזור ואם מותר לפנות אליהם.
            </EmptyState>
          )
        ) : (
          <>
            <div className="px-5 py-3 border-b border-line text-[13px] text-ink-3">
              {total > rows.length ? `מוצגים ${rows.length.toLocaleString("he-IL")} מתוך ${total.toLocaleString("he-IL")}. כדאי לצמצם בחיפוש.` : `${total.toLocaleString("he-IL")} אנשים`}
            </div>
            <table className="hidden md:table w-full text-sm">
              <caption className="sr-only">אנשים עם מקצוע או כישורים</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 px-3 ps-5">שם</th>
                  <th scope="col" className="text-start font-medium px-3">מקצוע וכישורים</th>
                  <th scope="col" className="text-start font-medium px-3">מגורים</th>
                  <th scope="col" className="text-start font-medium px-3">מחזור</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">נכונות והסכמה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas align-top">
                    <td className="py-3 px-3 ps-5">
                      <Link href={`/contacts/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline">{r.full_name}</Link>
                      {r.is_demo && <span className="ms-2"><DemoTag /></span>}
                    </td>
                    <td className="py-3 px-3">
                      {r.profession && <div className="text-ink">{r.profession}</div>}
                      <SkillBadges skills={r.skills} term={term} />
                    </td>
                    <td className="py-3 px-3 text-ink-2">{[r.city, lookups.regionLabel(r.region_id)].filter(Boolean).join(", ") || <span className="text-ink-3">—</span>}</td>
                    <td className="py-3 px-3 text-ink-2">{lookups.cohortLabel(r.cohort_id) || <span className="text-ink-3">—</span>}</td>
                    <td className="py-3 px-3 pe-5"><ConsentBadges r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/contacts/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline">{r.full_name}</Link>
                    {r.is_demo && <DemoTag />}
                  </div>
                  {r.profession && <div className="text-sm text-ink-2 mt-0.5">{r.profession}</div>}
                  <SkillBadges skills={r.skills} term={term} />
                  <div className="text-[12px] text-ink-3 mt-1.5">
                    {[r.city ?? lookups.regionLabel(r.region_id), lookups.cohortLabel(r.cohort_id) && `מחזור ${lookups.cohortLabel(r.cohort_id)}`].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-2"><ConsentBadges r={r} /></div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

function SkillBadges({ skills, term }: { skills: string[]; term: string }) {
  if (!skills.length) return null;
  const t = term.toLowerCase();
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {skills.map((s) => <Badge key={s} tone={t && s.toLowerCase() === t ? "brand" : "neutral"}>{s}</Badge>)}
    </div>
  );
}

function ConsentBadges({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.skills_share_consent ? (
        <Badge tone="ok"><ShieldCheck className="size-3.5" aria-hidden />הסכים/ה שנפנה</Badge>
      ) : (
        <Badge tone="neutral" title="לפני שמפנים אליו/ה מישהו, צריך לשאול">אין הסכמה לפנייה</Badge>
      )}
      {r.available_to_help && <Badge tone="info"><HandHelping className="size-3.5" aria-hidden />מוכן/ה לעזור</Badge>}
    </div>
  );
}

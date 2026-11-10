import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader, Stat, buttonClass } from "@/components/ui";
import { DuplicatePair, type PairContact } from "@/components/quality/duplicate-pair";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "איכות נתונים" };

const PER_PAGE = 20;

const CHECKS: { key: string; label: string; hint: string; warn?: boolean }[] = [
  { key: "missing_phone", label: "חסר טלפון", hint: "אין דרך להתקשר" },
  { key: "phone_invalid", label: "טלפון לא תקין", hint: "סומן כשגוי", warn: true },
  { key: "unreachable", label: "לא עונים", hint: "3 ניסיונות אחרונים ללא מענה", warn: true },
  { key: "not_verified", label: "לא אומתו מעל שנה", hint: "או שמעולם לא אומתו" },
  { key: "missing_cohort", label: "חסר מחזור", hint: "לא יופיעו ברשימות מחזור" },
  { key: "missing_region", label: "חסר אזור", hint: "לא יופיעו ברשימות אזור" },
  { key: "no_owner", label: "ללא אחראי/ת קשר", hint: "אף אחד לא שומר על הקשר", warn: true },
];

type Dup = { a: string; b: string; reasons: string; score: number };
type Row = {
  id: string; full_name: string; phone: string | null; email: string | null; cohort_id: number | null; region_id: number | null;
  city: string | null; created_at: string; source: string; is_demo: boolean; archived_at: string | null;
  interactions: { count: number }[];
};

export default async function QualityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const role = staff.role;
  if (!perms.reviewDuplicates(role)) {
    return (
      <>
        <PageHeader title="איכות נתונים" back={{ href: "/contacts", label: "אנשים" }} />
        <Notice tone="warn" title="אין לך הרשאה למסך הזה">בדיקת כפילויות ואיכות הנתונים זמינה למנהלי העמותה ולרכזי הקהילה.</Notice>
      </>
    );
  }
  const supabase = await createClient();
  const lookups = await getLookups();
  const canMerge = perms.mergeContacts(role);

  const health = () => supabase.from("contact_health").select("contact_id", { count: "exact", head: true });
  const [total, staleSetting, dupRes, ...checks] = await Promise.all([
    health(),
    supabase.from("settings").select("value").eq("key", "stale_after_days").maybeSingle<{ value: number }>(),
    supabase.rpc("find_duplicates", { p_limit: 200 }),
    ...CHECKS.map((c) => health().eq(c.key, true)),
  ]);
  const staleDays = Number(staleSetting.data?.value ?? 365) || 365;
  const totalCount = total.count ?? 0;

  const dups = (dupRes.data ?? []) as Dup[];
  const pages = Math.max(1, Math.ceil(dups.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.page ?? 1) || 1));
  const shown = dups.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const ids = [...new Set(shown.flatMap((d) => [d.a, d.b]))];
  const people = new Map<string, PairContact>();
  if (ids.length) {
    const { data } = await supabase.from("contacts")
      .select("id,full_name,phone,email,cohort_id,region_id,city,created_at,source,is_demo,archived_at,interactions(count)")
      .in("id", ids)
      .returns<Row[]>();
    for (const r of data ?? []) {
      people.set(r.id, {
        id: r.id, full_name: r.full_name, phone: r.phone, email: r.email,
        cohort: lookups.cohortLabel(r.cohort_id), region: lookups.regionLabel(r.region_id), city: r.city,
        created_at: r.created_at, source: r.source, is_demo: r.is_demo, archived: !!r.archived_at,
        interactions: r.interactions?.[0]?.count ?? 0,
      });
    }
  }
  const nameOnly = dups.filter((d) => d.reasons.trim() === "שם דומה").length;
  const qs = (p: number) => `?page=${p}#duplicates`;

  return (
    <>
      <PageHeader
        title="איכות נתונים"
        back={{ href: "/contacts", label: "אנשים" }}
        description="כמה הרשימה שלנו עדכנית, ואילו רשומות כפולות כדאי לאחד."
        actions={perms.importData(role) ? <LinkButton href="/contacts/import" size="sm">ייבוא מקובץ</LinkButton> : undefined}
      />

      <section aria-labelledby="health-title" className="mb-8">
        <h2 id="health-title" className="text-[15px] font-semibold mb-1">מצב הרשימה</h2>
        <p className="text-[13px] text-ink-3 mb-3">
          {totalCount.toLocaleString("he-IL")} אנשים פעילים ברשימה. לחיצה על כרטיס פותחת את הרשימה המסוננת לטיפול.
        </p>
        {total.error ? (
          <Notice tone="danger">לא הצלחנו לחשב את מצב הרשימה. רעננו את הדף.</Notice>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {CHECKS.map((c, i) => {
              const count = checks[i].count;
              const pct = totalCount && count ? Math.round((count / totalCount) * 100) : 0;
              return (
                <Stat
                  key={c.key}
                  label={c.label}
                  value={count === null ? "—" : count.toLocaleString("he-IL")}
                  hint={count ? `${pct}% · ${c.hint}` : c.hint}
                  href={`/contacts?health=${c.key}`}
                  tone={c.warn && count ? "warn" : "neutral"}
                />
              );
            })}
            <Stat
              label="כפילויות לבדיקה"
              value={dupRes.error ? "—" : `${dups.length.toLocaleString("he-IL")}${dups.length >= 200 ? "+" : ""}`}
              hint={nameOnly ? `מתוכן ${nameOnly.toLocaleString("he-IL")} לפי שם בלבד` : "זוגות רשומות דומות"}
              href="#duplicates"
              tone={dups.length ? "warn" : "neutral"}
            />
          </div>
        )}
      </section>

      <Card className="mb-8">
        <CardHeader title="איך שומרים על הרשימה עדכנית" />
        <ul className="px-5 pb-5 grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-ink-2">
          <li>
            <p className="font-medium text-ink">קישור לעדכון עצמי</p>
            בכרטיס של כל אדם יש כפתור &quot;קישור לעדכון פרטים&quot;. שולחים אותו בוואטסאפ, והאדם מאשר או מתקן את הפרטים בעצמו, בלי להתחבר.
            הקישור אישי ובתוקף 30 יום, ואחרי העדכון הרשומה מסומנת כמאומתת.
          </li>
          <li>
            <p className="font-medium text-ink">רשומות מתיישנות</p>
            רשומה שהפרטים בה לא אומתו {staleDays.toLocaleString("he-IL")} ימים — בקישור העצמי או בכפתור &quot;אימתתי את הפרטים היום&quot; בכרטיס —
            נספרת כאן תחת &quot;לא אומתו מעל שנה&quot;. כדאי לשלוח להם קישור לעדכון, או לאמת בשיחה הבאה.
          </li>
          <li>
            <p className="font-medium text-ink">מספרים שלא עונים</p>
            אחרי שלושה ניסיונות רצופים ללא מענה, הרשומה מסומנת &quot;לא עונים&quot;. ייתכן שהמספר השתנה — נסו דוא״ל או חבר מהמחזור.
          </li>
          <li>
            <p className="font-medium text-ink">ייבוא בלי כפילויות</p>
            בייבוא מקובץ, מי שכבר קיים מזוהה לפי טלפון או דוא״ל, ורק שדות ריקים מושלמים. מה שבכל זאת נכפל יופיע למטה.
          </li>
        </ul>
      </Card>

      <section id="duplicates" aria-labelledby="dup-title" className="scroll-mt-4">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <h2 id="dup-title" className="text-[15px] font-semibold">רשומות שנראות כפולות</h2>
            <p className="text-[13px] text-ink-3 mt-0.5">
              {canMerge
                ? "איחוד מעביר את כל ההיסטוריה לרשומה שנשארת ומעביר את השנייה לארכיון. אם אלה אנשים שונים — סמנו \"זה לא אותו אדם\"."
                : "איחוד רשומות זמין למנהל/ת עמותה או מערכת. אפשר לסמן \"זה לא אותו אדם\" כדי שהזוג לא יוצע שוב."}
            </p>
          </div>
        </div>

        {dupRes.error ? (
          <Notice tone="danger">לא הצלחנו לחפש כפילויות. רעננו את הדף.</Notice>
        ) : !dups.length ? (
          <Card><EmptyState title="לא נמצאו כפילויות">אין כרגע רשומות עם אותו טלפון, אותו דוא״ל או שם דומה מאוד. כל הכבוד!</EmptyState></Card>
        ) : (
          <div className="flex flex-col gap-4">
            {shown.map((d) => {
              const a = people.get(d.a);
              const b = people.get(d.b);
              if (!a || !b) return null;
              return <DuplicatePair key={`${d.a}-${d.b}`} a={a} b={b} reasons={d.reasons} score={d.score} canMerge={canMerge} />;
            })}
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="דפים" className="flex items-center justify-between mt-4 text-sm">
            {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={qs(page - 1)}>→ הקודם</Link> : <span />}
            <span className="text-ink-3">עמוד {page} מתוך {pages}</span>
            {page < pages ? <Link className={buttonClass("secondary", "sm")} href={qs(page + 1)}>הבא ←</Link> : <span />}
          </nav>
        )}
        {dups.length >= 200 && <p className="text-[12px] text-ink-3 mt-3">מוצגים 200 הזוגות הסבירים ביותר. אחרי שתטפלו בהם יופיעו הבאים.</p>}
      </section>
    </>
  );
}

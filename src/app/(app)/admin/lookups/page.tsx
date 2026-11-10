import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/components/admin/guard";
import { AddLookupForm, CareStatusRow, ContactTypeRow, LookupRow, type LookupItem } from "@/components/admin/lookup-forms";
import { createClient } from "@/lib/supabase/server";
import type { CareStatus, ContactType } from "@/lib/types";

export const metadata: Metadata = { title: "רשימות" };

export default async function AdminLookupsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [cohorts, regions, statuses, types] = await Promise.all([
    supabase.from("cohorts").select("id,label,sort_key,active").order("sort_key").order("label").returns<LookupItem[]>(),
    supabase.from("regions").select("id,label,sort_key").order("sort_key").order("label").returns<LookupItem[]>(),
    supabase.from("care_statuses").select("*").order("sort_key").returns<CareStatus[]>(),
    supabase.from("contact_types").select("*").order("sort_key").returns<ContactType[]>(),
  ]);
  const failed = [cohorts, regions, statuses, types].some((r) => r.error);

  return (
    <>
      <PageHeader
        title="רשימות"
        description="הערכים שמופיעים ברשימות הבחירה בכל המערכת. שינוי שם מתעדכן מיד בכל הרשומות."
        back={{ href: "/admin", label: "ניהול" }}
      />
      {failed && <div className="mb-4"><Notice tone="danger">חלק מהרשימות לא נטענו. רעננו את הדף.</Notice></div>}

      <div className="flex flex-col gap-6">
        <div className="grid gap-6 xl:grid-cols-2 items-start">
          <Card aria-labelledby="cohorts">
            <CardHeader id="cohorts" title="מחזורים"
              subtitle="מחזור שלא פעיל יוסתר מרשימות הבחירה אבל יישאר על האנשים שכבר משויכים אליו. סדר: מספר קטן מופיע ראשון." />
            {(cohorts.data ?? []).length === 0 ? (
              <EmptyState title="עדיין אין מחזורים">הוסיפו את המחזורים של היחידה כדי שאפשר יהיה לשייך אליהם אנשים.</EmptyState>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {(cohorts.data ?? []).map((c) => <li key={c.id}><LookupRow kind="cohort" item={c} /></li>)}
              </ul>
            )}
            <AddLookupForm kind="cohort" />
          </Card>

          <Card aria-labelledby="regions">
            <CardHeader id="regions" title="אזורי מגורים" subtitle="משמשים לסינון, לשיוך אחראי/ת אזור ולתכנון אירועים." />
            {(regions.data ?? []).length === 0 ? (
              <EmptyState title="עדיין אין אזורים">הוסיפו אזורים כדי לשייך אליהם אנשים ואחראי/ות אזור.</EmptyState>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {(regions.data ?? []).map((r) => <li key={r.id}><LookupRow kind="region" item={r} /></li>)}
              </ul>
            )}
            <AddLookupForm kind="region" />
          </Card>
        </div>

        <Card aria-labelledby="statuses">
          <CardHeader id="statuses" title="מצבי קשר"
            subtitle={'המצב קובע כל כמה זמן מתוכננת שיחת "מה שלומך", ואת סדר הדחיפות ברשימת השיחות. הקוד שבסוגריים קבוע כי המערכת נשענת עליו.'} />
          <div className="px-5 pb-3 text-[13px] text-ink-2">
            דחיפות 3 מופיעה ראשונה באדום, 2 בכתום, 1 בכחול ו-0 בירוק. שדה תדירות ריק = כל 90 ימים. אפשר גם לקבוע תדירות אישית לכל אדם בכרטיס שלו.
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {(statuses.data ?? []).map((s) => <li key={s.code}><CareStatusRow item={s} /></li>)}
          </ul>
        </Card>

        <Card aria-labelledby="types">
          <CardHeader id="types" title="סוגי קשר" subtitle="התגיות שמסמנות מי האדם עבור העמותה. אדם יכול להיות כמה סוגים. הקוד שבסוגריים קבוע." />
          <div className="px-5 pb-3">
            <Notice tone="info" title={'מה המשמעות של "רגיש"?'}>
              תגית רגישה (למשל פצוע/ה, בליווי מיוחד, משפחה שכולה) מוסתרת לגמרי מ<strong>רכזי תורמים</strong>: הם לא רואים אותה בכרטיס, לא יכולים לסנן לפיה ולא יכולים להוסיף או להסיר אותה.
              כל שאר התפקידים רואים אותה, אבל רק לגבי האנשים שבתחום ההרשאה שלהם. ההסתרה נאכפת במסד הנתונים.
              &quot;תורם/ת&quot; לא יכול להיות רגיש, כי רכזי התורמים עובדים לפיו.
            </Notice>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {(types.data ?? []).map((t) => <li key={t.code}><ContactTypeRow item={t} /></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}

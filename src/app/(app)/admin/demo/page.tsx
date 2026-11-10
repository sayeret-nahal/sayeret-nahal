import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/components/admin/guard";
import { DemoDeleteForm } from "@/components/admin/demo-delete-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "נתוני דוגמה" };

export default async function AdminDemoPage() {
  await requireAdmin();
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [contacts, cases, donations, events, fallen, interactions, tasks] = await Promise.all([
    supabase.from("contacts").select("id", head).eq("is_demo", true),
    supabase.from("cases").select("id", head).eq("is_demo", true),
    supabase.from("donations").select("id", head).eq("is_demo", true),
    supabase.from("events").select("id", head).eq("is_demo", true),
    supabase.from("fallen").select("id", head).eq("is_demo", true),
    supabase.from("interactions").select("id, contacts!inner(is_demo)", head).eq("contacts.is_demo", true),
    supabase.from("tasks").select("id, contacts!inner(is_demo)", head).eq("contacts.is_demo", true),
  ]);
  const failed = [contacts, cases, donations, events, fallen].some((r) => r.error);
  const counts = [
    { label: "אנשים", n: contacts.count ?? 0 },
    { label: "פניות", n: cases.count ?? 0 },
    { label: "תרומות", n: donations.count ?? 0 },
    { label: "אירועים", n: events.count ?? 0 },
    { label: "נופלים", n: fallen.count ?? 0 },
  ];
  const total = counts.reduce((s, c) => s + c.n, 0);

  return (
    <>
      <PageHeader
        title="נתוני דוגמה"
        description="רשומות לדוגמה עוזרות להכיר את המערכת. לפני שמתחילים לעבוד עם מידע אמיתי — מוחקים אותן."
        back={{ href: "/admin", label: "ניהול" }}
      />

      {failed && <div className="mb-4"><Notice tone="danger">לא הצלחנו לספור את כל נתוני הדוגמה. רעננו את הדף לפני מחיקה.</Notice></div>}

      <div className="flex flex-col gap-6">
        <section aria-labelledby="demo-counts">
          <h2 id="demo-counts" className="sr-only">כמה רשומות דוגמה יש</h2>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {counts.map((c) => <Stat key={c.label} label={c.label} value={c.n.toLocaleString("he-IL")} tone={c.n ? "warn" : "neutral"} />)}
          </div>
          {(contacts.count ?? 0) > 0 && !interactions.error && !tasks.error && (
            <p className="text-[13px] text-ink-3 mt-2">
              לאנשי הדוגמה קשורים גם {(interactions.count ?? 0).toLocaleString("he-IL")} תיעודי קשר ו-{(tasks.count ?? 0).toLocaleString("he-IL")} משימות. הם יימחקו יחד איתם.
            </p>
          )}
        </section>

        <Card aria-labelledby="demo-delete">
          <CardHeader id="demo-delete" title="מחיקת כל נתוני הדוגמה" subtitle={'נמחקות רק רשומות שמסומנות כ"דוגמה". רשומות אמיתיות לא נפגעות.'} />
          <div className="px-5 pb-5">
            {total === 0 && !failed ? (
              <EmptyState title="אין נתוני דוגמה במערכת">המערכת מוכנה לעבודה עם מידע אמיתי. דוחות לא יציגו אזהרת נתוני דוגמה.</EmptyState>
            ) : (
              <div className="flex flex-col gap-4">
                <ul className="list-disc ps-5 text-sm text-ink-2 flex flex-col gap-1">
                  <li>המחיקה היא לצמיתות ואי אפשר לבטל אותה.</li>
                  <li>יחד עם אנשי הדוגמה יימחקו גם מצב הקשר, התיעוד, התגיות והמשימות שלהם.</li>
                  <li>כל עוד יש נתוני דוגמה, דוח האימפקט מסומן &quot;לא לשליחה&quot;.</li>
                  <li>המחיקה נרשמת ביומן הפעולות.</li>
                </ul>
                <DemoDeleteForm total={total} />
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { TopicForm, type Topic } from "@/components/admin/topic-form";
import { requireAdmin } from "@/components/admin/guard";
import { getAppUrl } from "@/components/admin/app-url";
import { createClient } from "@/lib/supabase/server";
import { perms } from "@/lib/permissions";
import type { AppRole } from "@/lib/types";

export const metadata: Metadata = { title: "ניתוב פניות מהאתר" };



export default async function InquiryTopicsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const app = await getAppUrl();
  const [{ data: topics }, { data: staff }] = await Promise.all([
    supabase.from("inquiry_topics").select("*").order("sort_key").order("label"),
    supabase.from("staff").select("id, full_name, role, is_active").eq("is_active", true).order("full_name"),
  ]);
  const eligible = ((staff ?? []) as { id: string; full_name: string; role: AppRole }[]).filter((s) => perms.seeCases(s.role));
  return (
    <>
      <PageHeader title="ניתוב פניות מהאתר" back={{ href: "/admin/integrations", label: "חיבורים" }}
        description={<>כל פנייה מהאתר נפתחת כפנייה במערכת, עם העדיפות של הנושא, ומשויכת לאחראי/ת. טופס הפנייה: <a className="text-brand hover:underline" href={`${app.url}/contact`} target="_blank" rel="noopener noreferrer" dir="ltr">{app.url}/contact</a></>} />
      <Card>
        <CardHeader title="נושאים" subtitle="רק אנשי צוות שיכולים לראות פניות מופיעים ברשימת האחראים." />
        <ul className="divide-y divide-line border-t border-line">
          {((topics ?? []) as Topic[]).map((t) => (
            <li key={t.code} className="px-5 py-4">
              <div className="flex items-center gap-2 mb-2 text-[12px] text-ink-3"><code dir="ltr">{t.code}</code>{!t.active && <Badge>לא פעיל</Badge>}</div>
              <TopicForm t={t} staff={eligible} />
            </li>
          ))}
          <li className="px-5 py-4 bg-canvas/60">
            <div className="text-sm font-medium mb-2">נושא חדש</div>
            <TopicForm staff={eligible} />
          </li>
        </ul>
      </Card>
    </>
  );
}

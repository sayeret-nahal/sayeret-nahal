import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/broadcasts/template-form";
import { requireStaff } from "@/lib/auth";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "תבניות הודעה" };


export default async function TemplatesPage() {
  const { staff } = await requireStaff();
  if (!perms.sendBroadcast(staff.role)) redirect("/broadcasts");
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("*").order("created_at", { ascending: false });
  const rows = (data ?? []) as { id: number; name: string; channel: string; provider_template: string | null; category: string; body: string; variables: string[]; active: boolean }[];
  return (
    <>
      <PageHeader title="תבניות הודעה" back={{ href: "/broadcasts", label: "הודעות תפוצה" }}
        description="בוואטסאפ: יוצרים את התבנית באתר של 019 ומחכים לאישור של Meta, ואז מוסיפים אותה כאן עם המזהה שלה ובדיוק אותו נוסח." />
      <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
        <Card>
          <CardHeader title="תבניות קיימות" />
          <ul className="divide-y divide-line border-t border-line">
            {rows.length === 0 && <li className="px-5 py-4 text-sm text-ink-3">עוד אין תבניות.</li>}
            {rows.map((t) => (
              <li key={t.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 mb-1"><span className="font-medium">{t.name}</span>
                  <Badge>{t.channel === "sms" ? "SMS" : "וואטסאפ"}</Badge><Badge tone={t.category === "marketing" ? "warn" : "neutral"}>{t.category === "marketing" ? "שיווקית / בקשת תרומה" : "עדכון שירות"}</Badge>
                  {t.provider_template && <code className="text-[12px] text-ink-3" dir="ltr">{t.provider_template}</code>}</div>
                <p className="text-sm text-ink-2 whitespace-pre-wrap">{t.body}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="תבנית חדשה" />
          <TemplateForm />
        </Card>
      </div>
    </>
  );
}

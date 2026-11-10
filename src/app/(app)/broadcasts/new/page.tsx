import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, Card, LinkButton, PageHeader } from "@/components/ui";
import { ComposeForm } from "@/components/broadcasts/compose-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "הודעה חדשה" };

export default async function NewBroadcastPage() {
  const { staff } = await requireStaff();
  if (!perms.broadcast(staff.role)) redirect("/");
  const supabase = await createClient();
  const lookups = await getLookups();
  const { data } = await supabase.from("message_templates").select("id,name,channel,body,variables,category").eq("active", true).order("name");
  const templates = (data ?? []) as { id: number; name: string; channel: string; body: string; variables: string[]; category: string }[];
  return (
    <>
      <PageHeader title="הודעה חדשה" back={{ href: "/broadcasts", label: "הודעות תפוצה" }}
        description="שומרים טיוטה, ומנהל/ת מאשר/ת את השליחה. ההודעה תגיע רק למי שהסכים/ה לקבל הודעות." />
      {templates.length === 0 ? (
        <Card><EmptyState title="אין עדיין תבניות" action={perms.sendBroadcast(staff.role) ? <LinkButton href="/broadcasts/templates" size="sm" variant="primary">הוספת תבנית</LinkButton> : undefined}>
          בוואטסאפ אפשר לשלוח הודעות יזומות רק בתבניות שאושרו (יוצרים אותן באתר של 019, ומוסיפים כאן את המזהה).
        </EmptyState></Card>
      ) : (
        <ComposeForm templates={templates} types={lookups.types.filter((t) => !t.is_sensitive).map((t) => ({ code: t.code, label: t.label }))}
          cohorts={lookups.cohorts} regions={lookups.regions} />
      )}
    </>
  );
}

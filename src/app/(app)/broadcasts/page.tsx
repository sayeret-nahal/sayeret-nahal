import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BROADCAST_STATUS } from "@/components/broadcasts/status";
import { requireStaff } from "@/lib/auth";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { whatsappConfigured, smsConfigured } from "@/lib/integrations/sms019";

export const metadata: Metadata = { title: "הודעות תפוצה" };


type Row = { id: string; title: string; status: string; audience_count: number | null; created_at: string; queued_at: string | null; message_templates: { name: string; channel: string } | null };

export default async function BroadcastsPage() {
  const { staff } = await requireStaff();
  if (!perms.broadcast(staff.role)) redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.from("broadcasts").select("id,title,status,audience_count,created_at,queued_at,message_templates(name,channel)").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as unknown as Row[];
  const ready = whatsappConfigured() || smsConfigured();
  return (
    <>
      <PageHeader title="הודעות תפוצה" description="וואטסאפ ו-SMS דרך 019 — רק למי שהסכים/ה לקבל הודעות, עם הסרה בהשבת &quot;הסר&quot;."
        actions={<>
          {perms.sendBroadcast(staff.role) && <LinkButton href="/broadcasts/templates" variant="secondary" size="sm">תבניות</LinkButton>}
          <LinkButton href="/broadcasts/new" variant="primary" size="sm">הודעה חדשה</LinkButton>
        </>} />
      {!ready && <p className="text-sm text-warn bg-warn-soft rounded-lg px-3 py-2 mb-4">החיבור ל-019 עוד לא הוגדר. אפשר להכין טיוטות; השליחה תתחיל אחרי ההגדרה (ניהול ← חיבורים).</p>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="עוד לא נשלחו הודעות" action={<LinkButton href="/broadcasts/new" size="sm" variant="primary">הודעה חדשה</LinkButton>}>
            מכינים הודעה, בוחרים קהל (מחזור, אזור, יישוב, חברי עמותה, הרשימה הורודה…), ומנהל/ת מאשר/ת את השליחה.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/broadcasts/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="min-w-0">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-[12px] text-ink-3">{r.message_templates?.channel === "sms" ? "SMS" : "וואטסאפ"} · {r.message_templates?.name} · {formatDateTime(r.queued_at ?? r.created_at)}{r.audience_count ? ` · ${r.audience_count.toLocaleString("he-IL")} נמענים` : ""}</div>
                  </div>
                  <Badge tone={BROADCAST_STATUS[r.status]?.tone}>{BROADCAST_STATUS[r.status]?.label ?? r.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

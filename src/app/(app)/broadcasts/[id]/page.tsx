import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { ApproveForm } from "@/components/broadcasts/approve-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { whatsappConfigured, smsConfigured } from "@/lib/integrations/sms019";
import { cancelBroadcast, resumeSending } from "../actions";
import { BROADCAST_STATUS } from "@/components/broadcasts/status";
import { Fragment } from "react";

export const metadata: Metadata = { title: "הודעת תפוצה" };

const R_STATUS: Record<string, string> = { queued: "בתור", sending: "בשליחה", sent: "נשלחו", delivered: "נמסרו", read: "נקראו", failed: "נכשלו", skipped: "דולגו (הסרה/ביטול)" };

export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { staff } = await requireStaff();
  if (!perms.broadcast(staff.role)) redirect("/");
  const supabase = await createClient();
  const { data: b } = await supabase.from("broadcasts").select("*, message_templates(name,channel,body,variables,category)").eq("id", id).maybeSingle();
  if (!b) notFound();
  const lookups = await getLookups();
  const canSend = perms.sendBroadcast(staff.role);
  const counts: Record<string, number> = {};
  if (canSend && b.status !== "draft") {
    await Promise.all(Object.keys(R_STATUS).map(async (s) => {
      const { count } = await supabase.from("broadcast_recipients").select("id", { count: "exact", head: true }).eq("broadcast_id", id).eq("status", s);
      counts[s] = count ?? 0;
    }));
  }
  const audience = canSend && b.status === "draft"
    ? (await supabase.rpc("broadcast_audience_count", { p_filters: b.filters }).single<{ total: number; consented: number }>()).data
    : null;
  const t = b.message_templates as { name: string; channel: string; body: string; variables: string[]; category: string } | null;
  const f = b.filters as { types?: string[]; cohort_ids?: number[]; region_ids?: number[]; city?: string; pink?: boolean; members_active?: boolean };
  const filterText = [
    f.types?.length ? f.types.map((c) => lookups.typeLabel(c)).join(" / ") : null,
    f.members_active ? "חברי עמותה פעילים" : null,
    f.pink ? "הרשימה הורודה" : null,
    f.cohort_ids?.length ? `מחזורים: ${f.cohort_ids.map((c) => lookups.cohortLabel(c)).join(", ")}` : null,
    f.region_ids?.length ? `אזורים: ${f.region_ids.map((c) => lookups.regionLabel(c)).join(", ")}` : null,
    f.city ? `יישוב: ${f.city}` : null,
  ].filter(Boolean).join(" · ") || "כל מי שהסכים/ה לקבל הודעות";
  const configured = t?.channel === "sms" ? smsConfigured() : whatsappConfigured();

  return (
    <>
      <PageHeader title={b.title} back={{ href: "/broadcasts", label: "הודעות תפוצה" }}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={BROADCAST_STATUS[b.status]?.tone}>{BROADCAST_STATUS[b.status]?.label}</Badge>{t?.channel === "sms" ? "SMS" : "וואטסאפ"} · {t?.name}</span>} />
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="תוכן" subtitle={`קהל: ${filterText}`} />
            <p className="mx-5 mb-5 whitespace-pre-wrap rounded-lg bg-canvas p-3 text-[15px]">{t?.body}</p>
          </Card>

          {b.status === "draft" && canSend && (
            <Card>
              <CardHeader title="אישור ושליחה" subtitle={audience ? `${audience.consented.toLocaleString("he-IL")} נמענים שהסכימו${audience.total > audience.consented ? ` · ${(audience.total - audience.consented).toLocaleString("he-IL")} לא הסכימו ולא יקבלו` : ""}` : undefined} />
              {!configured && <div className="px-5"><Notice tone="warn">החיבור ל-019 עוד לא הוגדר. אחרי האישור, ההודעות ימתינו בתור עד ההגדרה.</Notice></div>}
              <ApproveForm id={b.id} />
            </Card>
          )}
          {b.status === "draft" && !canSend && <Notice tone="info">הטיוטה נשמרה. מנהל/ת העמותה צריך/ה לאשר את השליחה.</Notice>}
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader title="מצב השליחה" />
            <dl className="px-5 pb-5 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              {b.status === "draft" ? <><dt className="text-ink-3">עוד לא אושרה</dt><dd /></> : Object.entries(R_STATUS).map(([k, v]) => counts[k] ? <Fragment key={k}><dt className="text-ink-3">{v}</dt><dd className="tabular-nums font-medium">{counts[k].toLocaleString("he-IL")}</dd></Fragment> : null)}
              {b.queued_at && <><dt className="text-ink-3">אושרה</dt><dd className="text-[13px]">{formatDateTime(b.queued_at)}</dd></>}
              {b.finished_at && <><dt className="text-ink-3">הסתיימה</dt><dd className="text-[13px]">{formatDateTime(b.finished_at)}</dd></>}
            </dl>
            {canSend && ["queued", "sending"].includes(b.status) && (
              <div className="border-t border-line px-5 py-3 flex gap-2">
                <form action={resumeSending}><input type="hidden" name="id" value={b.id} /><button className="text-sm text-brand hover:underline">המשך שליחה עכשיו</button></form>
                <form action={cancelBroadcast}><input type="hidden" name="id" value={b.id} /><button className="text-sm text-danger hover:underline">עצירה</button></form>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

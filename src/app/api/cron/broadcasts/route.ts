// Broadcast sender. Called by Vercel Cron (Authorization: Bearer CRON_SECRET) and right after a
// manager approves a broadcast. Sends in small batches within a time budget, then calls itself again
// until the queue is empty. The database re-checks consent at send time and hands out each recipient
// once (FOR UPDATE SKIP LOCKED), so overlapping runs never double-send.
import { after, NextResponse } from "next/server";
import { ingestClient, ingestSecret, safeEqual } from "@/lib/integrations/ingest";
import { fillTemplate, sendSms, sendWhatsAppTemplate, smsConfigured, whatsappConfigured } from "@/lib/integrations/sms019";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Item = { recipient_id: number; phone: string; vars: string[]; channel: "whatsapp" | "sms"; provider_template: string | null; language: string; body: string };

const BUDGET_MS = 45_000;
const PER_SECOND = 15; // well under 019's 80 msg/s

export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET;
  if (!cron || !safeEqual(req.headers.get("authorization"), `Bearer ${cron}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const secret = ingestSecret();
  if (!secret) return NextResponse.json({ error: "INGEST_SECRET missing" }, { status: 503 });
  // Not configured yet: leave everything queued (approved broadcasts wait for the 019 setup)
  if (!whatsappConfigured() && !smsConfigured()) return NextResponse.json({ ok: true, waiting: "019 not configured" });
  const db = ingestClient();
  // SMS marketing messages must say how to opt out (Communications Law §30א)
  const footer = process.env.BROADCAST_SMS_FOOTER || "להסרה מרשימת התפוצה השיבו: הסר";

  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let more = false;
  while (Date.now() - started < BUDGET_MS) {
    const { data, error } = await db.rpc("claim_broadcast_batch", { p_secret: secret, p_limit: PER_SECOND * 2 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Item[];
    if (!batch.length) {
      more = false;
      break;
    }
    more = true;
    const results = [];
    let retries = 0;
    for (const it of batch) {
      if (it.channel === "whatsapp" ? !whatsappConfigured() : !smsConfigured()) {
        results.push({ id: it.recipient_id, ok: false, retry: true, error: "channel not configured" });
        retries++;
        continue;
      }
      const r = it.channel === "whatsapp"
        ? it.provider_template
          ? await sendWhatsAppTemplate(it.phone, it.provider_template, it.vars)
          : { ok: false, error: "template has no 019 id" }
        : await sendSms(it.phone, `${fillTemplate(it.body, it.vars)}\n${footer}`, { id: `r${it.recipient_id}` });
      results.push({ id: it.recipient_id, ok: r.ok, message_id: r.messageId ?? null, error: r.error ?? null });
      if (r.ok) sent++;
      else failed++;
      await new Promise((res) => setTimeout(res, 1000 / PER_SECOND));
    }
    const rep = await db.rpc("report_broadcast_results", { p_secret: secret, p_results: results });
    if (rep.error) return NextResponse.json({ error: rep.error.message }, { status: 500 });
    if (retries === batch.length) {
      more = false; // only unconfigured channels left — stop until the setup is done
      break;
    }
  }

  if (more) {
    // keep going in a fresh invocation (fire and forget)
    const url = new URL(req.url);
    after(() => fetch(url, { headers: { authorization: `Bearer ${cron}` } }).then(() => undefined, () => undefined));
  }
  return NextResponse.json({ ok: true, sent, failed, more });
}

// Incoming webhooks: /api/hooks/jgive | grow | nexus | 019?key=<secret>
// Providers don't sign their requests, so each URL carries a long random key (HOOK_KEY…), and the
// database accepts writes only with the server's ingest secret. Every event is logged (with its raw
// payload) and de-duplicated by the provider's transaction id, so retries are safe.
import { NextResponse } from "next/server";
import { fromGrow, fromJGive, fromNexus, readBody } from "@/lib/integrations/normalize";
import { hookKeyFor, ingestClient, ingestSecret, safeEqual } from "@/lib/integrations/ingest";

export const dynamic = "force-dynamic";

const PROVIDERS = ["jgive", "grow", "nexus", "019"] as const;
type Provider = (typeof PROVIDERS)[number];

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as Provider)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const secret = ingestSecret();
  const key = hookKeyFor(provider);
  if (!secret || !key) return NextResponse.json({ error: "integration not configured" }, { status: 503 });
  if (!safeEqual(new URL(req.url).searchParams.get("key"), key)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readBody(req);
  const db = ingestClient();

  try {
    if (provider === "jgive" || provider === "grow") {
      // Grow sends a webhookKey in the payload; when configured, it must match too.
      if (provider === "grow" && process.env.GROW_WEBHOOK_KEY) {
        const wk = String(body.webhookKey ?? body.webhook_key ?? (body.data as Record<string, unknown> | undefined)?.webhookKey ?? "");
        if (!safeEqual(wk, process.env.GROW_WEBHOOK_KEY)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const ev = provider === "jgive" ? fromJGive(body) : fromGrow(body);
      if (!ev) return NextResponse.json({ ok: true, ignored: true });
      const { data, error } = await db.rpc("ingest_payment", { p_secret: secret, p_provider: provider, p_event: ev });
      if (error) throw error;
      return NextResponse.json({ ok: true, result: (data as { status: string })?.status });
    }

    if (provider === "nexus") {
      const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [body];
      let processed = 0;
      for (const row of rows.slice(0, 500)) {
        const ev = fromNexus(row);
        if (!ev) continue;
        const { error } = await db.rpc("ingest_benefit_usage", { p_secret: secret, p_provider: "nexus", p_event: ev });
        if (error) throw error;
        processed++;
      }
      return NextResponse.json({ ok: true, processed });
    }

    // 019: WhatsApp webhook (JSON: hook = new | update | system) or SMS push (form: dlr / incoming)
    const events = from019(body);
    for (const ev of events) {
      const { error } = await db.rpc("ingest_message_event", { p_secret: secret, p_event: ev });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 500 makes the provider retry; the event is de-duplicated when it arrives again
    console.error(`[hooks/${provider}]`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "temporary failure" }, { status: 500 });
  }
}

const ACK: Record<string, string> = { "0": "failed", "1": "sent", "2": "delivered", "3": "read" };
const SMS_DLR: Record<string, string> = { "102": "delivered" };

function from019(b: Record<string, unknown>): Record<string, unknown>[] {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const hook = str(b.hook);
  if (hook === "new") {
    return [{ kind: "inbound", phone: str(b.from), text: str(b.body), message_id: str(b.id ?? b.messageId), raw: b }];
  }
  if (hook === "update") {
    const status = ACK[str(b.ack)];
    return status ? [{ kind: "status", message_id: str(b.id ?? b.messageId ?? b.message_id), status, raw: b }] : [];
  }
  if (b.type === "incoming_sms" || (b.message && b.phone && !b.status)) {
    return [{ kind: "inbound", phone: str(b.phone), text: str(b.message), raw: b }];
  }
  if (b.status !== undefined && (b.external_id || b.shipment_id)) {
    const status = SMS_DLR[str(b.status)] ?? (/^1\d\d$/.test(str(b.status)) ? "sent" : "failed");
    return [{ kind: "status", message_id: str(b.external_id || b.shipment_id), status, raw: b }];
  }
  return [];
}

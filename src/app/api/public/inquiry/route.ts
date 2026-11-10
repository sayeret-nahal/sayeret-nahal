// JSON endpoint for the association's website, for sites that build their own form:
//   GET  /api/public/inquiry          → { topics: [{ code, label, description }] }
//   POST /api/public/inquiry          { topic, name, phone, email?, message, consent?, page?, website? (honeypot) }
//                                     → { ok: true, ref } | { ok: false, error }
// Browsers may call it only from the origins in WEBSITE_ORIGINS (comma separated).
import { NextResponse } from "next/server";
import { ipAllowed } from "@/lib/rate-limit";
import { BOT_CHECK_FAILED, humanVerified } from "@/lib/turnstile";
import { notifyNewPublicCase } from "@/lib/notify";
import { ingestClient } from "@/lib/integrations/ingest";
import { after } from "next/server";

export const dynamic = "force-dynamic";

const origins = () => (process.env.WEBSITE_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

function cors(req: Request, res: NextResponse) {
  const o = req.headers.get("origin");
  if (o && origins().includes(o)) {
    res.headers.set("Access-Control-Allow-Origin", o);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}

export function OPTIONS(req: Request) {
  return cors(req, new NextResponse(null, { status: 204 }));
}

export async function GET(req: Request) {
  const { data } = await ingestClient().rpc("public_inquiry_topics");
  return cors(req, NextResponse.json({ topics: data ?? [] }));
}

export async function POST(req: Request) {
  const o = req.headers.get("origin");
  if (o && !origins().includes(o)) return NextResponse.json({ ok: false, error: "origin not allowed" }, { status: 403 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return cors(req, NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }));
  }
  // when Turnstile is on, the site's own form must include a widget and send its token
  if (!(await humanVerified(b.turnstile_token))) return cors(req, NextResponse.json({ ok: false, error: BOT_CHECK_FAILED }, { status: 403 }));
  if (!(await ipAllowed("inquiry-api"))) return cors(req, NextResponse.json({ ok: false, error: "נשלחו כבר כמה פניות. נסו שוב בעוד כמה דקות." }, { status: 429 }));
  const t = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "");
  const { data, error } = await ingestClient().rpc("submit_inquiry", {
    p_topic: t("topic", 30), p_name: t("name", 80), p_phone: t("phone", 30), p_email: t("email", 120) || null,
    p_message: t("message", 2000), p_consent: b.consent === true, p_page: t("page", 300) || null, p_hp: t("website", 200) || null,
  });
  if (error) {
    const msg = error.code === "P0001" ? error.message : "הפנייה לא נשלחה. נסו שוב בעוד רגע.";
    return cors(req, NextResponse.json({ ok: false, error: msg }, { status: error.code === "P0001" ? 422 : 500 }));
  }
  const ref = Number(data) || 0;
  if (ref > 0) after(() => notifyNewPublicCase({ ref, kind: "request", name: t("name", 80) }).catch(() => undefined));
  return cors(req, NextResponse.json({ ok: true, ref: ref || null }));
}

// The public "join the community" questionnaire posts here (form sayeret-join-2026).
// The page sends JSON as text/plain (a "simple" request, no CORS preflight); browsers may read the
// answer only from origins listed in WEBSITE_ORIGINS. All checks are repeated in the database.
import { NextResponse } from "next/server";
import { ingestClient } from "@/lib/integrations/ingest";
import { ipAllowed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const origins = () => (process.env.WEBSITE_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const MAX_BODY = 600_000; // the optional selfie is a small JPEG

function cors(req: Request, res: NextResponse) {
  const o = req.headers.get("origin");
  if (o && origins().includes(o)) {
    res.headers.set("Access-Control-Allow-Origin", o);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return res;
}

export function OPTIONS(req: Request) {
  return cors(req, new NextResponse(null, { status: 204 }));
}

/** data:image/jpeg;base64,… → "\x…" hex for a bytea parameter, only if it really is a JPEG under 300 KB. */
function jpegHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 100 || buf.length > 300 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return "\\x" + buf.toString("hex");
}

export async function POST(req: Request) {
  const o = req.headers.get("origin");
  if (o && !origins().includes(o)) return NextResponse.json({ ok: false, error: "origin not allowed" }, { status: 403 });
  if (!(await ipAllowed("join", 5, 10 * 60_000))) {
    return cors(req, NextResponse.json({ ok: false, error: "נשלחו כבר כמה טפסים מהמכשיר הזה. נסו שוב בעוד כמה דקות." }, { status: 429 }));
  }
  const text = await req.text();
  if (text.length > MAX_BODY) return cors(req, NextResponse.json({ ok: false, error: "too large" }, { status: 413 }));
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return cors(req, NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }));
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.form !== "sayeret-join-2026") {
    return cors(req, NextResponse.json({ ok: false, error: "unknown form" }, { status: 400 }));
  }
  const photo = jpegHex(body.selfie_jpeg);
  delete body.selfie_jpeg;
  const { data, error } = await ingestClient().rpc("submit_join", { p: body, p_photo: photo });
  if (error) {
    const msg = error.code === "P0001" ? error.message : "השליחה לא הצליחה. נסו שוב בעוד רגע.";
    return cors(req, NextResponse.json({ ok: false, error: msg }, { status: error.code === "P0001" ? 422 : 500 }));
  }
  return cors(req, NextResponse.json({ ok: true, status: (data as { status?: string })?.status ?? "processed" }));
}

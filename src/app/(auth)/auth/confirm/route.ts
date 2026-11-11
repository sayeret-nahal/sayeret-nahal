import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// E-mail confirmation / recovery links land here.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const supabase = await createClient();
  let ok = false;
  if (token_hash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  const dest = !ok ? "/login?error=confirm" : type === "recovery" ? "/auth/reset" : "/auth/mfa";
  const res = NextResponse.redirect(new URL(dest, request.url));
  // a fresh sign-in through an e-mail link starts a fresh idle window (see src/proxy.ts)
  if (ok) res.cookies.set("crm_last_activity", String(Date.now()), { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/" });
  return res;
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ACTIVITY_COOKIE = "crm_last_activity";
const IDLE_MS = Number(process.env.IDLE_MINUTES ?? 30) * 60_000;

// Paths that work without a staff session.
const PUBLIC_PATHS = ["/login", "/talk", "/concern", "/update", "/auth", "/contact", "/embed", "/api/hooks", "/api/cron", "/api/public"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refreshes the session cookie. Authorization itself is enforced by RLS and requireStaff().
  // an expired/foreign/broken session cookie counts as "not signed in", never as a crash
  const data = await supabase.auth.getClaims().then((r) => r.data).catch(() => null);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  // Server-side inactivity timeout (the client-side IdleLogout is only a convenience):
  // a session cookie that was not used for IDLE_MINUTES is signed out here.
  if (data?.claims && !isPublic) {
    const last = Number(request.cookies.get(ACTIVITY_COOKIE)?.value ?? 0);
    if (last && Date.now() - last > IDLE_MS) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?reason=idle";
      const out = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => out.cookies.set(c));
      out.cookies.delete(ACTIVITY_COOKIE);
      return out;
    }
    response.cookies.set(ACTIVITY_COOKIE, String(Date.now()), {
      httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};

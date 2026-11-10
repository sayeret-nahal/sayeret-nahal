import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ACTIVITY_COOKIE = "crm_last_activity";
const IDLE_MS = Number(process.env.IDLE_MINUTES ?? 30) * 60_000;

// Paths that work without a staff session.
const PUBLIC_PATHS = ["/login", "/talk", "/concern", "/update", "/auth", "/contact", "/embed", "/api/hooks", "/api/cron", "/api/public"];

// Sites allowed to embed /embed/* forms (the association's website)
const EMBED_ORIGINS = (process.env.WEBSITE_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

/** Strict CSP: scripts only with this request's nonce ('strict-dynamic' lets them load Next's chunks). */
function contentSecurityPolicy(nonce: string, path: string, https: boolean): string {
  const dev = process.env.NODE_ENV === "development";
  const embed = path.startsWith("/embed/") && EMBED_ORIGINS.length > 0;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React's style={{…}} attributes need inline styles; style injection is far less dangerous than script
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://challenges.cloudflare.com`,
    "frame-src https://challenges.cloudflare.com",
    embed ? `frame-ancestors ${EMBED_ORIGINS.join(" ")}` : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, request.nextUrl.pathname, request.nextUrl.protocol === "https:");
  const out = await handle(request, nonce, csp);
  out.headers.set("Content-Security-Policy", csp);
  return out;
}

async function handle(request: NextRequest, nonce: string, csp: string) {
  // Next reads the nonce from the request's CSP header and adds it to its own <script> tags
  const next = () => {
    const h = new Headers(request.headers);
    h.set("x-nonce", nonce);
    h.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers: h } });
  };
  let response = next();
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
          response = next();
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

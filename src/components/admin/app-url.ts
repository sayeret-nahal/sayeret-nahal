import { headers } from "next/headers";

/**
 * Absolute base URL of the app. Prefers NEXT_PUBLIC_APP_URL (the canonical public address);
 * falls back to the current request's host so links still work before it is configured.
 */
export async function getAppUrl(): Promise<{ url: string; configured: boolean }> {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (env) return { url: env, configured: true };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { url: `${proto}://${host}`, configured: false };
}

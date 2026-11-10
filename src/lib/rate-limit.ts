import { headers } from "next/headers";

// Best-effort per-IP limiter for the public forms. It lives in server memory, so on a multi-instance
// host it limits per instance only — production should add an edge/WAF rule (see docs/04).
const hits = new Map<string, number[]>();

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown").split(",")[0].trim();
}

export async function ipAllowed(bucket: string, max = 5, windowMs = 10 * 60_000): Promise<boolean> {
  return keyAllowed(`${bucket}:${await clientIp()}`, max, windowMs);
}

/** Same limiter for any key (e.g. an e-mail address being tried at the login form). */
export function keyAllowed(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}

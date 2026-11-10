import { headers } from "next/headers";

// Best-effort per-IP limiter for the public forms. It lives in server memory, so on a multi-instance
// host it limits per instance only — production should add an edge/WAF rule (see docs/04).
const hits = new Map<string, number[]>();

export async function ipAllowed(bucket: string, max = 5, windowMs = 10 * 60_000): Promise<boolean> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
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

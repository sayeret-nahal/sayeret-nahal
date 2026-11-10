// Server-only. Calls the database's ingest functions with the shared secret.
// The secret never reaches the browser; the database stores only its hash (see 0009_integrations.sql).
import { timingSafeEqual } from "node:crypto";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { DB_SCHEMA } from "@/lib/supabase/schema";

export function ingestSecret(): string | null {
  const s = process.env.INGEST_SECRET;
  return s && s.length >= 32 ? s : null;
}

/** A Supabase client with no user session (anon key): it can only call the secret-protected functions. */
export function ingestClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Webhook URLs carry ?key=…; each provider can have its own key (HOOK_KEY_JGIVE …) or share HOOK_KEY. */
export function hookKeyFor(provider: string): string | null {
  const k = process.env[`HOOK_KEY_${provider.toUpperCase()}`] || process.env.HOOK_KEY;
  return k && k.length >= 24 ? k : null;
}

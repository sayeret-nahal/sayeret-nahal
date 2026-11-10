import type { createClient } from "./supabase/server";
import { addDays, todayIL } from "./dates";

// "הרשימה הורודה": people who used the association's discounts or community services (contact type
// 'pink') and are not active paying members. A payment within the last N months (setting
// active_payer_months, default 12) makes someone an active payer, and they drop off the list.
export const PINK_TYPE = "pink";

export async function activePayerCutoff(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.from("settings").select("value").eq("key", "active_payer_months").maybeSingle<{ value: number }>();
  const months = Number(data?.value) > 0 ? Number(data?.value) : 12;
  return addDays(todayIL(), -Math.round(months * 30.44));
}

export type PinkState = "on" | "paying" | null;

export function pinkState(typeCodes: string[], lastPaidAt: string | null | undefined, cutoff: string): PinkState {
  if (!typeCodes.includes(PINK_TYPE)) return null;
  return lastPaidAt && lastPaidAt >= cutoff ? "paying" : "on";
}

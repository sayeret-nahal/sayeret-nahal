"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { todayIL } from "@/lib/dates";
import type { ActionState } from "@/components/ui/client";
import { NOT_ADMIN, adminSession } from "@/components/admin/guard";

const int = (min: number, max: number, label: string) =>
  z.coerce.number({ message: `${label}: נא לכתוב מספר` }).int(`${label}: מספר שלם בלבד`)
    .min(min, `${label}: בין ${min} ל-${max}`).max(max, `${label}: בין ${min} ל-${max}`);
const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label}: לפחות ${min} תווים`).max(max, `${label}: עד ${max.toLocaleString("he-IL")} תווים`);

const schema = z.object({
  org_name: text(2, 80, "שם העמותה"),
  talk_response_hours: int(1, 168, "זמן תגובה לבקשת שיחה"),
  talk_response_text: text(10, 500, "הנוסח שמוצג אחרי בקשת שיחה"),
  concern_response_hours: int(1, 168, "זמן תגובה לדיווח חשש"),
  request_sla_days: int(1, 60, "זמן טיפול בפנייה רגילה"),
  idle_timeout_minutes: int(5, 240, "ניתוק אחרי חוסר פעילות"),
  stale_after_days: int(30, 1825, "אימות פרטים מחדש"),
  emergency_text: text(10, 600, "הודעת חירום"),
  privacy_notice_text: text(20, 4000, "הודעת הפרטיות"),
});

type Values = z.infer<typeof schema> & { require_mfa: boolean };

/** Date-based version, e.g. "2026-11-02", then "2026-11-02.2" for a second change on the same day. */
function nextPrivacyVersion(current: unknown): string {
  const today = todayIL();
  const cur = typeof current === "string" ? current : "";
  if (cur === today) return `${today}.2`;
  const m = cur.match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/);
  if (m && m[1] === today) return `${today}.${Number(m[2]) + 1}`;
  return today;
}

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await adminSession();
  if (!session) return NOT_ADMIN;

  const parsed = schema.safeParse(Object.fromEntries(Object.keys(schema.shape).map((k) => [k, fd.get(k) ?? ""])));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { error: "יש לתקן את השדות המסומנים", fieldErrors };
  }
  const values: Values = { ...parsed.data, require_mfa: fd.get("require_mfa") === "on" };

  const supabase = await createClient();
  const { data: rows, error: loadError } = await supabase.from("settings").select("key,value");
  if (loadError) return { error: "טעינת ההגדרות הנוכחיות נכשלה. נסו שוב." };
  const current = new Map((rows ?? []).map((r) => [r.key as string, r.value as unknown]));

  // Turning MFA off weakens protection for everyone: only with an explicit confirmation.
  if (current.get("require_mfa") !== false && !values.require_mfa && fd.get("confirm_mfa_off") !== "on") {
    return { error: "כדי לבטל את חובת האימות הדו-שלבי יש לסמן את תיבת האישור.", fieldErrors: { confirm_mfa_off: "נדרש אישור מפורש" } };
  }

  const changed: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (JSON.stringify(current.get(key)) !== JSON.stringify(value)) changed.push({ key, value });
  }
  if (changed.some((c) => c.key === "privacy_notice_text")) {
    changed.push({ key: "privacy_notice_version", value: nextPrivacyVersion(current.get("privacy_notice_version")) });
  }
  if (!changed.length) return { ok: true, message: "לא היו שינויים לשמור." };

  const { error } = await supabase.from("settings").upsert(changed, { onConflict: "key" });
  if (error) return { error: "השמירה נכשלה. נסו שוב." };

  revalidatePath("/", "layout");
  const versionNote = changed.some((c) => c.key === "privacy_notice_version") ? " נוצרה גרסה חדשה של הודעת הפרטיות." : "";
  return { ok: true, message: `נשמר (${changed.length} שינויים).${versionNote}` };
}

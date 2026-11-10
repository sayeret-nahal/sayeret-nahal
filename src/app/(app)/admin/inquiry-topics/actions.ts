"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { realAdminSession as adminSession, NOT_ADMIN } from "@/components/admin/guard";
import type { ActionState } from "@/components/ui/client";
import { createClient } from "@/lib/supabase/server";

const topicSchema = z.object({
  code: z.string().regex(/^[a-z_]{2,30}$/, "אותיות באנגלית קטנות וקו תחתון, 2–30 תווים"),
  label: z.string().trim().min(2, "נא לכתוב שם").max(60, "עד 60 תווים"),
  description: z.string().trim().max(200, "עד 200 תווים").nullable(),
  priority: z.enum(["normal", "high", "urgent"]),
  assignee_id: z.uuid().nullable(),
  active: z.boolean(),
  sort_key: z.number().int().min(0).max(9999),
});

export async function saveTopic(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const opt = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v ? v : null; };
  const parsed = topicSchema.safeParse({
    code: String(fd.get("code") ?? "").trim(),
    label: String(fd.get("label") ?? ""),
    description: opt("description"),
    priority: String(fd.get("priority") ?? "normal"),
    assignee_id: opt("assignee_id"),
    active: fd.get("active") === "on",
    sort_key: Number(fd.get("sort_key") ?? 0) || 0,
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { error: "יש לתקן את השדות המסומנים", fieldErrors: fe };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("inquiry_topics").upsert(parsed.data, { onConflict: "code" });
  if (error) return { error: "השמירה נכשלה. ודאו שהאחראי/ת יכול/ה לראות פניות." };
  revalidatePath("/admin/inquiry-topics");
  return { ok: true, message: "נשמר" };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/client";
import { requireStaff } from "@/lib/auth";
import { DEMO_BLOCKED, isDemoAccount } from "@/lib/demo";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export type Filters = { types?: string[]; cohort_ids?: number[]; region_ids?: number[]; city?: string; pink?: boolean; members_active?: boolean };

function readFilters(fd: FormData): Filters {
  const ints = (k: string) => fd.getAll(k).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return {
    types: fd.getAll("types").map(String).filter((t) => /^[a-z_]{2,30}$/.test(t)),
    cohort_ids: ints("cohort_ids"),
    region_ids: ints("region_ids"),
    city: String(fd.get("city") ?? "").trim().slice(0, 60) || undefined,
    pink: fd.get("pink") === "on" || undefined,
    members_active: fd.get("members_active") === "on" || undefined,
  };
}

/** Live audience size while composing (uses the user's own visibility). */
export async function previewAudience(fd: FormData): Promise<{ total: number; consented: number } | { error: string }> {
  const { staff } = await requireStaff();
  if (!perms.broadcast(staff.role)) return { error: "אין הרשאה" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("broadcast_audience_count", { p_filters: readFilters(fd) }).single<{ total: number; consented: number }>();
  if (error || !data) return { error: "החישוב נכשל" };
  return { total: data.total, consented: data.consented };
}

const draftSchema = z.object({
  title: z.string().trim().min(2, "נא לכתוב כותרת פנימית").max(120, "עד 120 תווים"),
  template_id: z.number().int().positive("נא לבחור תבנית"),
});

export async function saveDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.broadcast(staff.role)) return { error: "אין הרשאה" };
  const parsed = draftSchema.safeParse({ title: String(fd.get("title") ?? ""), template_id: Number(fd.get("template_id") ?? 0) });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { error: "יש לתקן את השדות המסומנים", fieldErrors: fe };
  }
  const custom = Array.from({ length: 5 }, (_, i) => String(fd.get(`custom_${i + 1}`) ?? "").trim().slice(0, 200));
  const supabase = await createClient();
  const { data, error } = await supabase.from("broadcasts")
    .insert({ ...parsed.data, custom_values: custom, filters: readFilters(fd) }).select("id").single();
  if (error || !data) return { error: "השמירה נכשלה. נסו שוב." };
  revalidatePath("/broadcasts");
  redirect(`/broadcasts/${data.id}`);
}

/** Management approval: freezes the recipient list and starts sending. */
export async function approveAndSend(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff, email } = await requireStaff();
  if (!perms.sendBroadcast(staff.role)) return { error: "רק הנהלה יכולה לאשר שליחה" };
  if (isDemoAccount(email)) return DEMO_BLOCKED;
  if (fd.get("confirm") !== "on") return { error: "נא לאשר שהתוכן נבדק ושהנמענים הסכימו" };
  const id = String(fd.get("id") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_broadcast", { p_id: id });
  if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : "האישור נכשל. נסו שוב." };
  await kickSender();
  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
  const r = data as { queued: number; skipped_no_consent: number };
  return { ok: true, message: `אושר. נשלח ל-${r.queued.toLocaleString("he-IL")} נמענים${r.skipped_no_consent ? ` (${r.skipped_no_consent.toLocaleString("he-IL")} לא הסכימו ולכן לא יקבלו)` : ""}.` };
}

export async function cancelBroadcast(fd: FormData): Promise<void> {
  const { staff, email } = await requireStaff();
  if (!perms.sendBroadcast(staff.role) || isDemoAccount(email)) return;
  const id = String(fd.get("id") ?? "");
  const supabase = await createClient();
  await supabase.rpc("cancel_broadcast", { p_id: id });
  revalidatePath(`/broadcasts/${id}`);
}

export async function resumeSending(fd: FormData): Promise<void> {
  const { staff, email } = await requireStaff();
  if (!perms.sendBroadcast(staff.role) || isDemoAccount(email)) return;
  await kickSender();
  revalidatePath(`/broadcasts/${String(fd.get("id") ?? "")}`);
}

/** Starts the sender right away instead of waiting for the scheduled run. */
async function kickSender() {
  const cron = process.env.CRON_SECRET;
  // only a server-configured address: the secret must never follow a request's Host header
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "")
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!cron || !/^https?:\/\//.test(base)) return;
  fetch(`${base}/api/cron/broadcasts`, { headers: { authorization: `Bearer ${cron}` }, signal: AbortSignal.timeout(2500) }).catch(() => undefined);
}

const templateSchema = z.object({
  name: z.string().trim().min(2, "נא לכתוב שם").max(80),
  channel: z.enum(["whatsapp", "sms"]),
  provider_template: z.string().trim().max(120).nullable(),
  category: z.enum(["marketing", "utility"]),
  body: z.string().trim().min(2, "נא לכתוב את נוסח ההודעה").max(1000),
  variables: z.array(z.enum(["first_name", "full_name", "cohort", "city", "custom"])).max(5),
});

export async function saveTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff, email } = await requireStaff();
  if (!perms.sendBroadcast(staff.role)) return { error: "רק הנהלה מנהלת תבניות" };
  if (isDemoAccount(email)) return DEMO_BLOCKED;
  const vars = Array.from({ length: 5 }, (_, i) => String(fd.get(`var_${i + 1}`) ?? "")).filter(Boolean);
  const parsed = templateSchema.safeParse({
    name: String(fd.get("name") ?? ""),
    channel: String(fd.get("channel") ?? ""),
    provider_template: String(fd.get("provider_template") ?? "").trim() || null,
    category: String(fd.get("category") ?? "marketing"),
    body: String(fd.get("body") ?? ""),
    variables: vars,
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { error: "יש לתקן את השדות המסומנים", fieldErrors: fe };
  }
  const t = parsed.data;
  if (t.channel === "whatsapp" && !t.provider_template) return { error: "לתבנית וואטסאפ צריך את מזהה התבנית המאושרת ב-019", fieldErrors: { provider_template: "חובה בוואטסאפ" } };
  const used = new Set([...t.body.matchAll(/\{\{\s*(\d)\s*\}\}/g)].map((m) => Number(m[1])));
  if ([...used].some((n) => n > t.variables.length)) return { error: "בנוסח יש משתנה שלא הוגדר לו ערך", fieldErrors: { body: "לכל {{n}} צריך להגדיר מה ממלא אותו" } };
  if (t.category === "marketing" && !/^\s*(פרסומת|בקשת תרומה)/.test(t.body)) {
    return { error: "הודעה שיווקית או בקשת תרומה חייבת להתחיל במילה \"פרסומת\" או \"בקשת תרומה\" (חוק התקשורת, סעיף 30א)", fieldErrors: { body: "להתחיל ב\"פרסומת\" או \"בקשת תרומה\"" } };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("message_templates").insert(t);
  if (error) return { error: error.code === "23505" ? "כבר יש תבנית בשם הזה" : "השמירה נכשלה" };
  revalidatePath("/broadcasts/templates");
  return { ok: true, message: "התבנית נשמרה" };
}

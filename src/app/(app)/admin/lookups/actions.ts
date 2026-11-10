"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/client";
import { NOT_ADMIN, adminSession } from "@/components/admin/guard";

const labelSchema = z.string().trim().min(1, "נא לכתוב שם").max(60, "עד 60 תווים");
const sortSchema = z.coerce.number({ message: "סדר: מספר בלבד" }).int("סדר: מספר שלם").min(-9999).max(9999);

function done(message: string): ActionState {
  revalidatePath("/admin/lookups");
  revalidatePath("/", "layout"); // lookups appear in filters and forms everywhere
  return { ok: true, message };
}

function readLabelSort(fd: FormData): { label: string; sort_key: number } | ActionState {
  const label = labelSchema.safeParse(fd.get("label") ?? "");
  const sort = sortSchema.safeParse(fd.get("sort_key") || 0);
  if (!label.success) return { error: label.error.issues[0].message, fieldErrors: { label: label.error.issues[0].message } };
  if (!sort.success) return { error: "סדר: מספר שלם בין ‎-9999 ל-9999", fieldErrors: { sort_key: "מספר שלם" } };
  return { label: label.data, sort_key: sort.data };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n.toLocaleString("he-IL")} ${many}`);

// ---------- cohorts & regions ----------

export async function saveCohort(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const r = readLabelSort(fd);
  if ("error" in r) return r;
  const { label, sort_key } = r as { label: string; sort_key: number };
  const id = Number(fd.get("id") ?? 0);
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("cohorts").update({ label, sort_key, active: fd.get("active") === "on" }).eq("id", id)
    : await supabase.from("cohorts").insert({ label, sort_key, active: true });
  if (error) return { error: error.code === "23505" ? "כבר קיים מחזור בשם הזה." : "השמירה נכשלה. נסו שוב." };
  return done(id ? "נשמר" : `המחזור "${label}" נוסף`);
}

export async function saveRegion(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const r = readLabelSort(fd);
  if ("error" in r) return r;
  const { label, sort_key } = r as { label: string; sort_key: number };
  const id = Number(fd.get("id") ?? 0);
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("regions").update({ label, sort_key }).eq("id", id)
    : await supabase.from("regions").insert({ label, sort_key });
  if (error) return { error: error.code === "23505" ? "כבר קיים אזור בשם הזה." : "השמירה נכשלה. נסו שוב." };
  return done(id ? "נשמר" : `האזור "${label}" נוסף`);
}

async function usage(kind: "cohort" | "region", id: number) {
  const supabase = await createClient();
  const col = kind === "cohort" ? "cohort_id" : "region_id";
  const scope = kind === "cohort" ? "cohort_scope" : "region_scope";
  const head = { count: "exact" as const, head: true };
  const [contacts, events, fallen, staff, invites] = await Promise.all([
    supabase.from("contacts").select("id", head).eq(col, id),
    supabase.from("events").select("id", head).eq(col, id),
    kind === "cohort" ? supabase.from("fallen").select("id", head).eq("cohort_id", id) : Promise.resolve({ count: 0, error: null }),
    supabase.from("staff").select("id", head).contains(scope, [id]),
    supabase.from("staff_invites").select("email", head).contains(scope, [id]),
  ]);
  const failed = [contacts, events, fallen, staff, invites].some((q) => q.error);
  return {
    failed,
    contacts: contacts.count ?? 0,
    events: events.count ?? 0,
    fallen: fallen.count ?? 0,
    staff: (staff.count ?? 0) + (invites.count ?? 0),
  };
}

async function deleteLookup(kind: "cohort" | "region", fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const id = Number(fd.get("id") ?? 0);
  if (!Number.isInteger(id) || id <= 0) return { error: "לא נמצא" };
  const u = await usage(kind, id);
  if (u.failed) return { error: "לא הצלחנו לבדוק אם הפריט בשימוש, ולכן לא מחקנו. נסו שוב." };
  const parts = [
    u.contacts && plural(u.contacts, "אדם אחד", "אנשים"),
    u.events && plural(u.events, "אירוע אחד", "אירועים"),
    u.fallen && plural(u.fallen, "נופל אחד", "נופלים"),
    u.staff && plural(u.staff, "משתמש/ת אחד/ת (כתחום אחריות)", "משתמשים (כתחום אחריות)"),
  ].filter(Boolean);
  if (parts.length) {
    const what = kind === "cohort" ? "המחזור" : "האזור";
    const alt = kind === "cohort"
      ? "במקום למחוק, אפשר לבטל את הסימון \"פעיל\" כדי להסתיר אותו מרשימות הבחירה, או להעביר קודם את האנשים למחזור אחר."
      : "במקום למחוק, אפשר לשנות את השם, או להעביר קודם את האנשים לאזור אחר (עדכון קבוצתי ברשימת האנשים).";
    return { error: `אי אפשר למחוק את ${what} — משויכים אליו: ${parts.join(", ")}. מחיקה הייתה מוחקת את השיוך שלהם ומידע היה הולך לאיבוד. ${alt}` };
  }
  const supabase = await createClient();
  const { error } = await supabase.from(kind === "cohort" ? "cohorts" : "regions").delete().eq("id", id);
  if (error) return { error: "המחיקה נכשלה. נסו שוב." };
  return done("נמחק");
}

export async function deleteCohort(_: ActionState, fd: FormData): Promise<ActionState> {
  return deleteLookup("cohort", fd);
}

export async function deleteRegion(_: ActionState, fd: FormData): Promise<ActionState> {
  return deleteLookup("region", fd);
}

// ---------- care statuses & contact types (codes are fixed: the system logic relies on them) ----------

export async function saveCareStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const code = String(fd.get("code") ?? "");
  const label = labelSchema.safeParse(fd.get("label") ?? "");
  if (!label.success) return { error: label.error.issues[0].message };
  const rawCadence = String(fd.get("cadence_days") ?? "").trim();
  const cadence = rawCadence === "" ? null : Number(rawCadence);
  if (cadence !== null && (!Number.isInteger(cadence) || cadence < 1 || cadence > 730)) return { error: "תדירות: מספר ימים בין 1 ל-730, או ריק" };
  const severity = Number(fd.get("severity"));
  if (![0, 1, 2, 3].includes(severity)) return { error: "נא לבחור רמת דחיפות" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("care_statuses").update({ label: label.data, cadence_days: cadence, severity }).eq("code", code).select("code");
  if (error || !data?.length) return { error: "השמירה נכשלה. נסו שוב." };
  return done("נשמר. תדירות חדשה חלה על השיחה הבאה שתתוכנן.");
}

export async function saveContactType(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const code = String(fd.get("code") ?? "");
  const label = labelSchema.safeParse(fd.get("label") ?? "");
  if (!label.success) return { error: label.error.issues[0].message };
  const sensitive = fd.get("is_sensitive") === "on";
  if (code === "donor" && sensitive) {
    return { error: "אי אפשר לסמן את \"תורם/ת\" כרגיש: רכזי התורמים צריכים לראות את הסימון הזה כדי לעבוד." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("contact_types").update({ label: label.data, is_sensitive: sensitive }).eq("code", code).select("code");
  if (error || !data?.length) return { error: "השמירה נכשלה. נסו שוב." };
  return done("נשמר");
}

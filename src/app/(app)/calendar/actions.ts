"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { perms } from "@/lib/permissions";
import { addDays, formatDate, memorialDates, todayIL } from "@/lib/dates";
import { ilLocalToISO } from "@/components/calendar/utils";
import type { ActionState } from "@/components/ui/client";

const opt = (s: FormDataEntryValue | null) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};
const optInt = (s: FormDataEntryValue | null) => (opt(s) ? Number(opt(s)) : null);

function issues(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

// ---------------------------------------------------------------- events

const eventSchema = z.object({
  title: z.string().trim().min(1, "נא לכתוב שם לאירוע").max(120, "עד 120 תווים"),
  date: z.iso.date("נא לבחור תאריך"),
  time: z.string().regex(/^\d{1,2}:\d{2}$/, "נא לבחור שעה"),
  location: z.string().max(200, "עד 200 תווים").nullable(),
  cohort_id: z.number().int().nullable(),
  region_id: z.number().int().nullable(),
  description: z.string().max(2000, "עד 2,000 תווים").nullable(),
});

export async function saveEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff, userId } = await requireStaff();
  if (!perms.manageEvents(staff.role)) return { error: "אין לך הרשאה לנהל אירועים" };
  const parsed = eventSchema.safeParse({
    title: String(fd.get("title") ?? ""),
    date: String(fd.get("date") ?? ""),
    time: String(fd.get("time") ?? ""),
    location: opt(fd.get("location")),
    cohort_id: optInt(fd.get("cohort_id")),
    region_id: optInt(fd.get("region_id")),
    description: opt(fd.get("description")),
  });
  if (!parsed.success) return { error: "יש לתקן את השדות המסומנים", fieldErrors: issues(parsed.error) };
  const { date, time, ...rest } = parsed.data;
  const starts_at = ilLocalToISO(date, time);
  if (!starts_at) return { error: "התאריך או השעה לא תקינים", fieldErrors: { date: "תאריך לא תקין" } };

  const supabase = await createClient();
  const id = opt(fd.get("id"));
  if (id) {
    // own events only (admins may edit any) — RLS allows wider updates, the UI rule is narrower
    const { data: ev } = await supabase.from("events").select("created_by").eq("id", id).maybeSingle();
    if (!ev) return { error: "האירוע לא נמצא" };
    if (ev.created_by !== userId && staff.role !== "admin") return { error: "אפשר לערוך רק אירועים שיצרת" };
    const { error } = await supabase.from("events").update({ ...rest, starts_at }).eq("id", id);
    if (error) return { error: "השמירה נכשלה. נסו שוב." };
  } else {
    const { error } = await supabase.from("events").insert({ ...rest, starts_at });
    if (error) return { error: "השמירה נכשלה. נסו שוב." };
  }
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true, message: id ? "האירוע עודכן" : "האירוע נוסף ללוח" };
}

export async function deleteEvent(fd: FormData) {
  const { staff, userId } = await requireStaff();
  if (!perms.manageEvents(staff.role)) return;
  const id = String(fd.get("id") ?? "");
  const supabase = await createClient();
  let q = supabase.from("events").delete().eq("id", id);
  if (staff.role !== "admin") q = q.eq("created_by", userId);
  await q;
  revalidatePath("/calendar");
  revalidatePath("/");
}

// ---------------------------------------------------------------- memorial → task

export async function createMemorialTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const { userId, staff } = await requireStaff();
  if (!perms.seeCare(staff.role)) return { error: "אין הרשאה" };
  const fallenId = String(fd.get("fallen_id") ?? "");
  const occasion = fd.get("occasion") === "anniversary" ? "anniversary" : "azkara";
  if (!z.uuid().safeParse(fallenId).success) return { error: "רשומה לא תקינה" };
  const supabase = await createClient();
  const { data: f } = await supabase
    .from("fallen")
    .select("id, first_name, last_name, death_date, after_sunset, owner_id")
    .eq("id", fallenId)
    .maybeSingle();
  if (!f) return { error: "הרשומה לא נמצאה" };

  const today = todayIL();
  const m = memorialDates(f.death_date, f.after_sunset, today);
  const day = occasion === "azkara" ? m.nextAzkara : m.nextAnniversary;
  const due = addDays(day, -7) < today ? today : addDays(day, -7);
  const name = `${f.first_name} ${f.last_name}`.trim();
  const what = occasion === "azkara" ? `יום האזכרה (${m.azkaraHebrew}, ${formatDate(day)})` : `יום השנה (${formatDate(day)})`;
  const title = `ליצור קשר עם המשפחה של ${name} ז״ל לקראת ${what}`.slice(0, 200);

  // avoid duplicates when someone clicks twice or a colleague already created it
  const { data: existing } = await supabase.from("tasks").select("id").eq("title", title).eq("status", "open").limit(1);
  if (existing?.length) return { ok: true, message: "כבר יש משימה פתוחה לזה" };

  // first family member this user may see (fallen_family is restricted by RLS)
  const { data: fam } = await supabase
    .from("fallen_family")
    .select("contact_id, contacts(full_name)")
    .eq("fallen_id", fallenId);
  const first = ((fam ?? []) as unknown as { contact_id: string; contacts: { full_name: string } | null }[])
    .filter((r) => r.contacts)
    .sort((a, b) => a.contacts!.full_name.localeCompare(b.contacts!.full_name, "he"))[0];

  const { error } = await supabase.from("tasks").insert({
    title,
    contact_id: first?.contact_id ?? null,
    assignee_id: f.owner_id ?? userId,
    due_date: due,
    priority: "normal",
  });
  if (error) return { error: "לא הצלחנו ליצור את המשימה. נסו שוב." };
  revalidatePath("/calendar");
  revalidatePath("/follow-up");
  revalidatePath("/");
  if (first) revalidatePath(`/contacts/${first.contact_id}`);
  return { ok: true, message: `נוצרה משימה ליום ${formatDate(due)}` };
}

// ---------------------------------------------------------------- fallen

const fallenSchema = z.object({
  first_name: z.string().trim().min(1, "נא לכתוב שם פרטי").max(60, "עד 60 תווים"),
  last_name: z.string().trim().min(1, "נא לכתוב שם משפחה").max(60, "עד 60 תווים"),
  cohort_id: z.number().int().nullable(),
  death_date: z.iso.date("נא לבחור תאריך"),
  after_sunset: z.boolean(),
  owner_id: z.uuid().nullable(),
  notes: z.string().max(2000, "עד 2,000 תווים").nullable(),
  rank: z.string().trim().max(60, "עד 60 תווים").nullable(),
  sub_unit: z.string().trim().max(120, "עד 120 תווים").nullable(),
  residence: z.string().trim().max(120, "עד 120 תווים").nullable(),
  burial_place: z.string().trim().max(200, "עד 200 תווים").nullable(),
  war_operation: z.string().trim().max(200, "עד 200 תווים").nullable(),
  enlistment_text: z.string().trim().max(60, "עד 60 תווים").nullable(),
  enlistment_year: z.number().int().min(1940, "שנה לא תקינה").max(2100, "שנה לא תקינה").nullable(),
  source_url: z.url({ protocol: /^https$/, error: "כתובת שמתחילה ב-https" }).max(500).nullable(),
});

export async function saveFallen(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.manageMemorials(staff.role)) return { error: "אין לך הרשאה לעדכן את רשימת החללים" };
  const parsed = fallenSchema.safeParse({
    first_name: String(fd.get("first_name") ?? ""),
    last_name: String(fd.get("last_name") ?? ""),
    cohort_id: optInt(fd.get("cohort_id")),
    death_date: String(fd.get("death_date") ?? ""),
    after_sunset: fd.get("after_sunset") === "on",
    owner_id: opt(fd.get("owner_id")),
    notes: opt(fd.get("notes")),
    rank: opt(fd.get("rank")),
    sub_unit: opt(fd.get("sub_unit")),
    residence: opt(fd.get("residence")),
    burial_place: opt(fd.get("burial_place")),
    war_operation: opt(fd.get("war_operation")),
    enlistment_text: opt(fd.get("enlistment_text")),
    enlistment_year: optInt(fd.get("enlistment_year")),
    source_url: opt(fd.get("source_url")),
  });
  if (!parsed.success) return { error: "יש לתקן את השדות המסומנים", fieldErrors: issues(parsed.error) };
  if (parsed.data.death_date > todayIL()) return { error: "יש לתקן את השדות המסומנים", fieldErrors: { death_date: "התאריך עוד לא הגיע" } };

  const supabase = await createClient();
  const id = opt(fd.get("id"));
  if (id) {
    const { error } = await supabase.from("fallen").update(parsed.data).eq("id", id);
    if (error) return { error: "השמירה נכשלה. נסו שוב." };
    revalidatePath(`/calendar/fallen/${id}`);
  } else {
    const { error } = await supabase.from("fallen").insert(parsed.data);
    if (error) return { error: "השמירה נכשלה. נסו שוב." };
  }
  revalidatePath("/calendar/fallen");
  revalidatePath("/calendar");
  return { ok: true, message: id ? "הפרטים עודכנו" : "נוסף/ה לרשימה" };
}

// ---------------------------------------------------------------- family links

const RELATIONS = ["הורה", "בן/בת זוג", "אח/ות", "ילד/ה"];

export async function addFamilyMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.manageMemorials(staff.role)) return { error: "אין לך הרשאה לקשר בני משפחה" };
  const fallenId = String(fd.get("fallen_id") ?? "");
  const contactId = String(fd.get("contact_id") ?? "");
  if (!z.uuid().safeParse(fallenId).success) return { error: "רשומה לא תקינה" };
  if (!z.uuid().safeParse(contactId).success) return { error: "נא לבחור אדם מהרשימה", fieldErrors: { contact_id: "נא לבחור אדם מהרשימה" } };
  const rel = String(fd.get("relation") ?? "");
  const other = (opt(fd.get("relation_other")) ?? "").slice(0, 40);
  const relation = RELATIONS.includes(rel) ? rel : rel === "other" ? other || "אחר" : null;
  if (!relation) return { error: "נא לבחור קרבה", fieldErrors: { relation: "נא לבחור קרבה" } };

  const supabase = await createClient();
  const { data: c } = await supabase.from("contacts").select("id").eq("id", contactId).maybeSingle();
  if (!c) return { error: "האדם לא נמצא" };
  const { error } = await supabase.from("fallen_family").insert({ fallen_id: fallenId, contact_id: contactId, relation });
  if (error) {
    if (error.code === "23505") return { error: "האדם הזה כבר מקושר/ת למשפחה" };
    return { error: "השמירה נכשלה. נסו שוב." };
  }
  revalidatePath(`/calendar/fallen/${fallenId}`);
  revalidatePath("/calendar");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true, message: "בן/בת המשפחה קושר/ה" };
}

export async function removeFamilyMember(fd: FormData) {
  const { staff } = await requireStaff();
  if (!perms.manageMemorials(staff.role)) return;
  const fallenId = String(fd.get("fallen_id") ?? "");
  const contactId = String(fd.get("contact_id") ?? "");
  const supabase = await createClient();
  await supabase.from("fallen_family").delete().eq("fallen_id", fallenId).eq("contact_id", contactId);
  revalidatePath(`/calendar/fallen/${fallenId}`);
  revalidatePath("/calendar");
  revalidatePath(`/contacts/${contactId}`);
}

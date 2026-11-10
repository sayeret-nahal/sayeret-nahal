"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { todayIL } from "@/lib/dates";
import { perms } from "@/lib/permissions";
import type { ActionState } from "@/components/ui/client";

const opt = (s: FormDataEntryValue | null) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};
const optInt = (s: FormDataEntryValue | null) => (opt(s) ? Number(opt(s)) : null);

const contactSchema = z.object({
  first_name: z.string().trim().min(1, "נא לכתוב שם פרטי").max(60),
  last_name: z.string().trim().max(60),
  email: z.email("כתובת הדוא״ל לא תקינה").nullable(),
  city: z.string().max(60).nullable(),
  cohort_id: z.number().int().nullable(),
  region_id: z.number().int().nullable(),
  owner_id: z.uuid().nullable(),
  birth_date: z.iso.date().nullable(),
  profession: z.string().max(80).nullable(),
  notes: z.string().max(2000, "עד 2,000 תווים").nullable(),
});

function readContact(fd: FormData) {
  return {
    first_name: String(fd.get("first_name") ?? ""),
    last_name: String(fd.get("last_name") ?? ""),
    email: opt(fd.get("email"))?.toLowerCase() ?? null,
    city: opt(fd.get("city")),
    cohort_id: optInt(fd.get("cohort_id")),
    region_id: optInt(fd.get("region_id")),
    owner_id: opt(fd.get("owner_id")),
    birth_date: opt(fd.get("birth_date")),
    profession: opt(fd.get("profession")),
    notes: opt(fd.get("notes")),
  };
}

function parseSkills(fd: FormData): string[] {
  return Array.from(new Set(String(fd.get("skills") ?? "").split(/[,\n،]/).map((s) => s.trim()).filter(Boolean))).slice(0, 20);
}

async function syncTypes(contactId: string, wanted: string[]) {
  const supabase = await createClient();
  // only the tags this user can see are touched (sensitive tags stay as they are for other roles)
  const { data: current } = await supabase.from("contact_type_links").select("type_code").eq("contact_id", contactId);
  const have = new Set((current ?? []).map((r) => r.type_code as string));
  const toAdd = wanted.filter((t) => !have.has(t));
  const toRemove = [...have].filter((t) => !wanted.includes(t));
  if (toRemove.length) await supabase.from("contact_type_links").delete().eq("contact_id", contactId).in("type_code", toRemove);
  if (toAdd.length) {
    const { error } = await supabase.from("contact_type_links").insert(toAdd.map((t) => ({ contact_id: contactId, type_code: t })));
    if (error) throw new Error(error.message);
  }
}

export async function saveContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.editContacts(staff.role)) return { error: "אין לך הרשאה לערוך פרטים" };
  const id = opt(fd.get("id"));
  const parsed = contactSchema.safeParse(readContact(fd));
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
  const rawPhone = opt(fd.get("phone"));
  const phone = normalizePhone(rawPhone);
  if (rawPhone && !phone) fieldErrors.phone = "מספר הטלפון לא תקין (לדוגמה 052-1234567)";
  if (Object.keys(fieldErrors).length || !parsed.success) return { error: "יש לתקן את השדות המסומנים", fieldErrors };

  const supabase = await createClient();
  const verifiedNow = fd.get("verified_now") === "on";
  const row = {
    ...parsed.data,
    phone,
    skills: parseSkills(fd),
    available_to_help: fd.get("available_to_help") === "on",
    skills_share_consent: fd.get("skills_share_consent") === "on",
    campaign_consent: fd.get("campaign_consent") === "yes" ? true : fd.get("campaign_consent") === "no" ? false : null,
    ...(verifiedNow ? { verified_at: new Date().toISOString(), verified_by: "staff" as const, phone_status: phone ? ("valid" as const) : ("unknown" as const) } : {}),
  };

  // Duplicate guard (only among records this user can see)
  if (fd.get("confirm_duplicate") !== "on" && (phone || row.email)) {
    let q = supabase.from("contacts").select("id, full_name").is("merged_into", null).limit(3);
    q = phone && row.email ? q.or(`phone.eq.${phone},email.eq.${row.email}`) : phone ? q.eq("phone", phone) : q.eq("email", row.email!);
    if (id) q = q.neq("id", id);
    const { data: dups } = await q;
    if (dups?.length) {
      return {
        error: `כבר קיים במערכת אדם עם אותו טלפון או דוא״ל: ${dups.map((d) => d.full_name).join(", ")}. אם זה אדם אחר, סמנו "זה אדם אחר" ושמרו שוב.`,
        fieldErrors: { duplicate: dups.map((d) => d.id).join(",") },
      };
    }
  }

  let contactId = id;
  if (id) {
    const { error } = await supabase.from("contacts").update(row).eq("id", id);
    if (error) return { error: "השמירה נכשלה. ייתכן שאין לך הרשאה לרשומה הזאת." };
  } else {
    const { data, error } = await supabase.from("contacts").insert({ ...row, source: "manual" }).select("id").single();
    if (error || !data) return { error: "השמירה נכשלה. נסו שוב." };
    contactId = data.id;
  }
  try {
    await syncTypes(contactId!, fd.getAll("types").map(String));
  } catch {
    return { error: "הפרטים נשמרו, אבל לא הצלחנו לעדכן את סוגי הקשר." };
  }
  const status = opt(fd.get("status_code"));
  if (status && perms.seeCare(staff.role)) {
    await supabase.from("contact_care").update({ status_code: status }).eq("contact_id", contactId!);
  }
  revalidatePath("/contacts");
  redirect(`/contacts/${contactId}`);
}

export async function logInteraction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const contactId = String(fd.get("contact_id"));
  const kind = String(fd.get("kind") ?? "call");
  const outcome = opt(fd.get("outcome"));
  const summary = opt(fd.get("summary"));
  const next = opt(fd.get("next_date"));
  const occurred = opt(fd.get("occurred_on"));
  if (summary && summary.length > 2000) return { error: "הסיכום ארוך מדי (עד 2,000 תווים)" };
  if (kind === "call" && !outcome) return { error: "נא לבחור מה הייתה תוצאת השיחה" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_interaction", {
    p_contact: contactId,
    p_kind: kind,
    p_outcome: outcome,
    p_summary: summary,
    p_next: next,
    // today → the actual time; an earlier day → midday of that day
    p_occurred: occurred && occurred !== todayIL() ? new Date(occurred + "T12:00:00+02:00").toISOString() : new Date().toISOString(),
    p_context: fd.get("context") === "donor" ? "donor" : "community",
  });
  if (error) return { error: "לא הצלחנו לשמור את התיעוד. ייתכן שאין לך הרשאה לאדם הזה." };
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/follow-up");
  revalidatePath("/");
  return { ok: true, message: "נשמר" };
}

export async function updateCare(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.seeCare(staff.role)) return { error: "אין הרשאה" };
  const contactId = String(fd.get("contact_id"));
  const cadence = optInt(fd.get("cadence_days"));
  if (cadence !== null && (cadence < 1 || cadence > 730)) return { error: "תדירות בין 1 ל-730 ימים" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status_code: String(fd.get("status_code")), cadence_days: cadence };
  const next = opt(fd.get("next_contact_at"));
  if (next) patch.next_contact_at = next;
  const { error } = await supabase.from("contact_care").update(patch).eq("contact_id", contactId);
  if (error) return { error: "השמירה נכשלה" };
  const owner = fd.get("owner_id");
  if (owner !== null && perms.editContacts(staff.role)) {
    await supabase.from("contacts").update({ owner_id: opt(owner) }).eq("id", contactId);
  }
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/follow-up");
  return { ok: true, message: "עודכן" };
}

export async function addTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const { userId } = await requireStaff();
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return { error: "נא לכתוב מה צריך לעשות" };
  const supabase = await createClient();
  const contactId = opt(fd.get("contact_id"));
  const { error } = await supabase.from("tasks").insert({
    title: title.slice(0, 200),
    contact_id: contactId,
    case_id: opt(fd.get("case_id")),
    assignee_id: opt(fd.get("assignee_id")) ?? userId,
    due_date: opt(fd.get("due_date")),
    priority: fd.get("priority") === "high" ? "high" : "normal",
  });
  if (error) return { error: "לא הצלחנו ליצור את המשימה" };
  if (contactId) revalidatePath(`/contacts/${contactId}`);
  const caseId = opt(fd.get("case_id"));
  if (caseId) revalidatePath(`/cases/${caseId}`);
  revalidatePath("/follow-up");
  revalidatePath("/");
  return { ok: true, message: "המשימה נוספה" };
}

export async function setTaskStatus(fd: FormData) {
  const { userId } = await requireStaff();
  const supabase = await createClient();
  const status = fd.get("status") === "done" ? "done" : fd.get("status") === "cancelled" ? "cancelled" : "open";
  await supabase.from("tasks").update({
    status,
    completed_at: status === "open" ? null : new Date().toISOString(),
    completed_by: status === "open" ? null : userId,
  }).eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}

export async function markPhone(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  const id = String(fd.get("id"));
  const status = fd.get("status") === "invalid" ? "invalid" : "valid";
  await supabase.from("contacts").update({ phone_status: status }).eq("id", id);
  revalidatePath(`/contacts/${id}`);
}

export async function markVerified(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  const id = String(fd.get("id"));
  await supabase.from("contacts").update({ verified_at: new Date().toISOString(), verified_by: "staff" }).eq("id", id);
  revalidatePath(`/contacts/${id}`);
}

export async function createUpdateLink(contactId: string): Promise<{ url?: string; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_update_link", { p_contact: contactId });
  if (error || !data) return { error: "לא הצלחנו ליצור קישור" };
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return { url: `${base}/update/${data}` };
}

export async function archiveContact(fd: FormData) {
  const { staff } = await requireStaff();
  if (!perms.mergeContacts(staff.role)) return;
  const supabase = await createClient();
  const id = String(fd.get("id"));
  await supabase.rpc("set_contact_archived", { p_contact: id, p_archived: !fd.get("restore") });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
}

export async function bulkUpdate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.bulkEdit(staff.role)) return { error: "אין הרשאה לעדכון קבוצתי" };
  const ids = fd.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) return { error: "לא נבחרו אנשים" };
  if (ids.length > 500) return { error: "אפשר לעדכן עד 500 אנשים בבת אחת" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  const owner = fd.get("owner_id");
  if (owner && owner !== "__keep") patch.owner_id = owner === "__none" ? null : owner;
  const cohort = fd.get("cohort_id");
  if (cohort && cohort !== "__keep") patch.cohort_id = Number(cohort);
  const region = fd.get("region_id");
  if (region && region !== "__keep") patch.region_id = Number(region);
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("contacts").update(patch).in("id", ids);
    if (error) return { error: "העדכון נכשל" };
  }
  const addType = opt(fd.get("add_type"));
  if (addType) {
    await supabase.from("contact_type_links").upsert(ids.map((id) => ({ contact_id: id, type_code: addType })), { ignoreDuplicates: true });
  }
  const status = opt(fd.get("status_code"));
  if (status) await supabase.from("contact_care").update({ status_code: status }).in("contact_id", ids);
  revalidatePath("/contacts");
  return { ok: true, message: `עודכנו ${ids.length} אנשים` };
}

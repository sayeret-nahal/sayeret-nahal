"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { perms } from "@/lib/permissions";
import { todayIL } from "@/lib/dates";
import { CATEGORY_LABELS } from "@/lib/labels";
import type { ActionState } from "@/components/ui/client";

const opt = (s: FormDataEntryValue | null) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};
const uuid = z.uuid();
const isUuid = (v: string | null): v is string => !!v && uuid.safeParse(v).success;

/** Errors raised on purpose by our triggers (errcode P0001) are written in Hebrew for the user. */
function dbError(error: { code?: string; message?: string } | null, fallback: string): string {
  if (error?.code === "P0001" && error.message) return error.message;
  return fallback;
}

/** Everything is rendered dynamically; refresh the case pages and the nav badge. */
function refresh(caseId?: string) {
  if (caseId) revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  revalidatePath("/", "layout");
}

/** End of the given day in Israel (handles summer / winter time). */
function endOfDayIL(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" })
    .formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const h = Number(tz.replace("GMT", "") || "2");
  const off = `${h >= 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}:00`;
  return new Date(`${date}T23:59:00${off}`).toISOString();
}

async function gate() {
  const s = await requireStaff();
  if (!perms.seeCases(s.staff.role)) return { ...s, denied: true as const };
  return { ...s, denied: false as const };
}

// ---------- create ----------

const SOURCES = ["staff", "phone", "whatsapp", "email", "other"] as const;

const caseSchema = z.object({
  kind: z.enum(["request", "concern"], { error: "נא לבחור סוג" }),
  category: z.string().refine((v) => Object.hasOwn(CATEGORY_LABELS, v),"קטגוריה לא מוכרת").nullable(),
  message: z.string().trim().min(3, "נא לכתוב במה מדובר (לפחות כמה מילים)").max(4000, "עד 4,000 תווים"),
  priority: z.enum(["normal", "high", "urgent"]),
  assignee_id: z.uuid().nullable(),
  source: z.enum(SOURCES),
  due_date: z.iso.date("תאריך לא תקין").nullable(),
});

export async function createCase(_: ActionState, fd: FormData): Promise<ActionState> {
  const { denied } = await gate();
  if (denied) return { error: "אין לך הרשאה לפתוח פניות" };

  const fieldErrors: Record<string, string> = {};
  const parsed = caseSchema.safeParse({
    kind: fd.get("kind"),
    category: opt(fd.get("category")),
    message: String(fd.get("message") ?? ""),
    priority: fd.get("priority") ?? "normal",
    assignee_id: opt(fd.get("assignee_id")),
    source: fd.get("source") ?? "staff",
    due_date: opt(fd.get("due_date")),
  });
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  if (parsed.success && parsed.data.due_date && parsed.data.due_date < todayIL()) fieldErrors.due_date = "המועד כבר עבר";

  const kind = parsed.success ? parsed.data.kind : fd.get("kind") === "concern" ? "concern" : "request";
  const contactId = opt(fd.get("contact_id"));
  if (contactId && !isUuid(contactId)) fieldErrors.contact_id = "האדם שנבחר לא נמצא";

  // Free-text person (when nobody was picked from the system)
  const personName = opt(fd.get("person_name"));
  const rawPhone = opt(fd.get("person_phone"));
  const personPhone = normalizePhone(rawPhone);
  if (rawPhone && !personPhone) fieldErrors.person_phone = "מספר הטלפון לא תקין (לדוגמה 052-1234567)";
  if (!contactId && (!personName || personName.length < 2)) fieldErrors.person_name = "נא לבחור אדם מהמערכת או לכתוב שם";
  if (personName && personName.length > 80) fieldErrors.person_name = "עד 80 תווים";

  // Who reported (concerns only)
  const reporterName = kind === "concern" ? opt(fd.get("reporter_name")) : null;
  const rawReporterPhone = kind === "concern" ? opt(fd.get("reporter_phone")) : null;
  const reporterPhone = normalizePhone(rawReporterPhone);
  if (rawReporterPhone && !reporterPhone) fieldErrors.reporter_phone = "מספר הטלפון לא תקין";
  if (reporterName && reporterName.length > 80) fieldErrors.reporter_name = "עד 80 תווים";

  if (!parsed.success || Object.keys(fieldErrors).length) return { error: "יש לתקן את השדות המסומנים", fieldErrors };
  const d = parsed.data;

  const row: Record<string, unknown> = {
    kind: d.kind,
    category: d.category ?? (d.kind === "concern" ? "concern" : null),
    message: d.message,
    priority: d.priority,
    assignee_id: d.assignee_id,
    source: d.source,
    contact_id: contactId,
  };
  if (d.due_date) row.due_at = endOfDayIL(d.due_date);
  if (!contactId) {
    if (d.kind === "concern") {
      row.subject_name = [personName, personPhone].filter(Boolean).join(" · ");
    } else {
      row.requester_name = personName;
      row.requester_phone = personPhone;
    }
  }
  if (d.kind === "concern") {
    row.requester_name = reporterName;
    row.requester_phone = reporterPhone;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("cases").insert(row).select("id").single();
  if (error || !data) return { error: dbError(error, "לא הצלחנו לפתוח את הפנייה. ייתכן שאין לך הרשאה לאדם שנבחר.") };
  refresh();
  if (contactId) revalidatePath(`/contacts/${contactId}`);
  redirect(`/cases/${data.id}`);
}

// ---------- activity ----------

export async function addCaseNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const { userId, denied } = await gate();
  if (denied) return { error: "אין הרשאה" };
  const caseId = opt(fd.get("case_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };
  const kind = fd.get("kind") === "call" ? "call" : "note";
  const body = String(fd.get("body") ?? "").trim();
  if (body.length < 2) return { error: kind === "call" ? "נא לכתוב בקצרה מה עלה בשיחה" : "נא לכתוב את ההערה", fieldErrors: { body: "שדה חובה" } };
  if (body.length > 4000) return { error: "עד 4,000 תווים", fieldErrors: { body: "ארוך מדי" } };

  const supabase = await createClient();
  const { error } = await supabase.from("case_events").insert({ case_id: caseId, kind, body, staff_id: userId });
  if (error) return { error: dbError(error, "לא הצלחנו לשמור. ייתכן שאין לך הרשאה לפנייה הזאת.") };
  refresh(caseId);
  return { ok: true, message: kind === "call" ? "השיחה תועדה" : "ההערה נשמרה" };
}

// ---------- assignment & status ----------

export async function assignCase(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff, userId, denied } = await gate();
  if (denied) return { error: "אין הרשאה" };
  const caseId = opt(fd.get("case_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };
  const assignee = opt(fd.get("assignee_id"));
  if (assignee && !isUuid(assignee)) return { error: "אחראי/ת לא תקין/ה" };

  const supabase = await createClient();
  const { error, count } = await supabase.from("cases").update({ assignee_id: assignee }, { count: "exact" }).eq("id", caseId);
  if (error) return { error: dbError(error, "העדכון נכשל") };
  if (count === 0) return { error: "הפנייה לא נמצאה או שאין לך הרשאה לעדכן אותה" };
  refresh(caseId);

  // Roles that see only their own cases may lose access after handing a case over.
  if (!perms.seeAllCases(staff.role) && assignee !== userId) {
    const { data } = await supabase.from("cases").select("id").eq("id", caseId).maybeSingle();
    if (!data) redirect("/cases?handed=1");
  }
  return { ok: true, message: assignee ? "האחריות עודכנה" : "האחריות הוסרה" };
}

export async function setCaseStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const { denied } = await gate();
  if (denied) return { error: "אין הרשאה" };
  const caseId = opt(fd.get("case_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };
  const status = z.enum(["new", "in_progress", "waiting"]).safeParse(fd.get("status"));
  if (!status.success) return { error: "נא לבחור סטטוס. לסגירת הפנייה משתמשים בטופס \"סגירת הפנייה\"." };

  const supabase = await createClient();
  const { error, count } = await supabase.from("cases").update({ status: status.data }, { count: "exact" })
    .eq("id", caseId).neq("status", "resolved");
  if (error) return { error: dbError(error, "העדכון נכשל") };
  if (count === 0) return { error: "לא ניתן לעדכן: הפנייה סגורה, לא נמצאה או שאין לך הרשאה" };
  refresh(caseId);
  return { ok: true, message: "הסטטוס עודכן" };
}

export async function resolveCase(_: ActionState, fd: FormData): Promise<ActionState> {
  const { denied } = await gate();
  if (denied) return { error: "אין הרשאה" };
  const caseId = opt(fd.get("case_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };
  const resolution = String(fd.get("resolution") ?? "").trim();
  if (resolution.length < 3) return { error: "נא לכתוב מה נעשה לפני הסגירה", fieldErrors: { resolution: "לפחות כמה מילים: מה נעשה ומה התוצאה" } };
  if (resolution.length > 4000) return { error: "עד 4,000 תווים", fieldErrors: { resolution: "ארוך מדי" } };

  const supabase = await createClient();
  const { error, count } = await supabase.from("cases").update({ status: "resolved", resolution }, { count: "exact" })
    .eq("id", caseId).neq("status", "resolved");
  if (error) return { error: dbError(error, "הסגירה נכשלה. נסו שוב.") };
  if (count === 0) return { error: "הפנייה כבר סגורה, לא נמצאה או שאין לך הרשאה" };
  refresh(caseId);
  return { ok: true, message: "הפנייה נסגרה" };
}

export async function reopenCase(_: ActionState, fd: FormData): Promise<ActionState> {
  const { denied } = await gate();
  if (denied) return { error: "אין הרשאה" };
  const caseId = opt(fd.get("case_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };
  const supabase = await createClient();
  const { error, count } = await supabase.from("cases").update({ status: "in_progress" }, { count: "exact" })
    .eq("id", caseId).eq("status", "resolved");
  if (error) return { error: dbError(error, "הפתיחה מחדש נכשלה") };
  if (count === 0) return { error: "הפנייה כבר פתוחה, לא נמצאה או שאין לך הרשאה" };
  refresh(caseId);
  return { ok: true, message: "הפנייה נפתחה מחדש" };
}

// ---------- link to a person ----------

export async function linkCaseToContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const { denied } = await gate();
  if (denied) return { error: "אין הרשאה" };
  const caseId = opt(fd.get("case_id"));
  const contactId = opt(fd.get("contact_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };
  if (!isUuid(contactId)) return { error: "נא לבחור אדם מהרשימה", fieldErrors: { contact_id: "נא לבחור אדם" } };

  const supabase = await createClient();
  const { error, count } = await supabase.from("cases").update({ contact_id: contactId }, { count: "exact" }).eq("id", caseId);
  if (error) return { error: dbError(error, "הקישור נכשל. ייתכן שאין לך הרשאה לאדם הזה.") };
  if (count === 0) return { error: "הפנייה לא נמצאה או שאין לך הרשאה" };
  refresh(caseId);
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true, message: "הפנייה קושרה לכרטיס האדם" };
}

export async function createContactFromCase(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff, userId, denied } = await gate();
  if (denied || !perms.createContacts(staff.role)) return { error: "אין לך הרשאה להוסיף אנשים" };
  const caseId = opt(fd.get("case_id"));
  if (!isUuid(caseId)) return { error: "הפנייה לא נמצאה" };

  const firstName = String(fd.get("first_name") ?? "").trim();
  const lastName = String(fd.get("last_name") ?? "").trim();
  const rawPhone = opt(fd.get("phone"));
  const phone = normalizePhone(rawPhone);
  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.first_name = "נא לכתוב שם פרטי";
  if (firstName.length > 60) fieldErrors.first_name = "עד 60 תווים";
  if (lastName.length > 60) fieldErrors.last_name = "עד 60 תווים";
  if (rawPhone && !phone) fieldErrors.phone = "מספר הטלפון לא תקין (לדוגמה 052-1234567)";
  if (Object.keys(fieldErrors).length) return { error: "יש לתקן את השדות המסומנים", fieldErrors };

  const supabase = await createClient();
  const { data: c } = await supabase.from("cases").select("id, source, assignee_id, contact_id").eq("id", caseId).maybeSingle();
  if (!c) return { error: "הפנייה לא נמצאה או שאין לך הרשאה" };
  if (c.contact_id) return { error: "הפנייה כבר מקושרת לאדם" };

  // Same phone already in the system (among people this user can see) → offer to link instead.
  if (phone && fd.get("confirm_new") !== "on") {
    const { data: dups } = await supabase.from("contacts").select("id, full_name").eq("phone", phone).is("merged_into", null).limit(3);
    if (dups?.length) {
      return {
        error: `כבר קיים במערכת אדם עם המספר הזה: ${dups.map((x) => x.full_name).join(", ")}. אפשר לקשר את הפנייה אליו, או לסמן "זה אדם אחר" ולשמור שוב.`,
        fieldErrors: { duplicate: dups.map((x) => `${x.id}|${x.full_name}`).join(",") },
      };
    }
  }

  const source = c.source === "talk_form" || c.source === "concern_form" ? c.source : "manual";
  // Owner: whoever handles the case (roles with a limited view must own it, or they could not see it).
  const ownerId = perms.seeAllCases(staff.role) ? (c.assignee_id ?? userId) : userId;
  const { data: created, error } = await supabase.from("contacts")
    .insert({ first_name: firstName, last_name: lastName, phone, source, owner_id: ownerId })
    .select("id").single();
  if (error || !created) return { error: dbError(error, "לא הצלחנו ליצור את כרטיס האדם") };

  const { error: linkErr } = await supabase.from("cases").update({ contact_id: created.id }).eq("id", caseId);
  if (linkErr) return { error: "כרטיס האדם נוצר, אבל הקישור לפנייה נכשל. אפשר לקשר אותו ידנית." };
  refresh(caseId);
  revalidatePath("/contacts");
  return { ok: true, message: "כרטיס האדם נוצר וקושר לפנייה" };
}

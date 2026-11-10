"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { perms } from "@/lib/permissions";
import { todayIL } from "@/lib/dates";
import { METHODS } from "@/components/donors/format";
import type { ActionState } from "@/components/ui/client";

const opt = (s: FormDataEntryValue | null) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};
/** "1,250.50" / "1250" / "₪ 1 250" → number (null when empty, NaN when not a number) */
const amount = (s: FormDataEntryValue | null) => {
  const v = opt(s);
  if (v === null) return null;
  const clean = v.replace(/[₪,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Number(clean) : NaN;
};

function issues(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

function revalidateDonors(contactId?: string) {
  revalidatePath("/donors");
  revalidatePath("/donors/donations");
  revalidatePath("/donors/campaigns");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

// ---------------------------------------------------------------- donations

const donationSchema = z.object({
  contact_id: z.uuid("נא לבחור תורם/ת מהרשימה"),
  amount: z.number("נא לכתוב סכום במספרים").positive("הסכום חייב להיות גדול מאפס").max(10_000_000, "הסכום גבוה מדי — כדאי לבדוק"),
  donated_at: z.iso.date("נא לבחור תאריך"),
  method: z.enum(METHODS).nullable(),
  campaign_id: z.number().int().nullable(),
  is_recurring: z.boolean(),
  external_ref: z.string().max(100, "עד 100 תווים").nullable(),
  notes: z.string().max(1000, "עד 1,000 תווים").nullable(),
});

export async function addDonation(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.manageDonors(staff.role)) return { error: "אין לך הרשאה לרשום תרומות" };
  const amt = amount(fd.get("amount"));
  const method = opt(fd.get("method"));
  const parsed = donationSchema.safeParse({
    contact_id: String(fd.get("contact_id") ?? ""),
    amount: amt === null ? undefined : amt,
    donated_at: String(fd.get("donated_at") ?? ""),
    method: method && (METHODS as readonly string[]).includes(method) ? method : null,
    campaign_id: opt(fd.get("campaign_id")) ? Number(fd.get("campaign_id")) : null,
    is_recurring: fd.get("is_recurring") === "on",
    external_ref: opt(fd.get("external_ref")),
    notes: opt(fd.get("notes")),
  });
  const fieldErrors = parsed.success ? {} : issues(parsed.error);
  if (amt === null) fieldErrors.amount = "נא לכתוב סכום";
  if (parsed.success && parsed.data.donated_at > todayIL()) fieldErrors.donated_at = "התאריך עוד לא הגיע";
  if (!parsed.success || Object.keys(fieldErrors).length) return { error: "יש לתקן את השדות המסומנים", fieldErrors };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: person } = await supabase.from("contacts").select("id, full_name").eq("id", d.contact_id).maybeSingle();
  if (!person) return { error: "האדם לא נמצא, או שאין לך הרשאה אליו", fieldErrors: { contact_id: "נא לבחור תורם/ת מהרשימה" } };

  const { error } = await supabase.from("donations").insert({ ...d, currency: "ILS" });
  if (error) {
    if (error.code === "23505") return { error: "כבר רשומה תרומה עם האסמכתה הזאת. ייתכן שהיא כבר יובאה.", fieldErrors: { external_ref: "אסמכתה קיימת" } };
    return { error: "השמירה נכשלה. נסו שוב." };
  }

  // make sure the person is tagged as a donor
  let tagNote = "";
  const { data: tag } = await supabase.from("contact_type_links").select("type_code").eq("contact_id", d.contact_id).eq("type_code", "donor").maybeSingle();
  if (!tag) {
    const { error: tagError } = await supabase.from("contact_type_links").insert({ contact_id: d.contact_id, type_code: "donor" });
    tagNote = tagError ? " לא הצלחנו לסמן אותו/ה כתורם/ת — כדאי לעשות זאת בכרטיס." : " סומן/ה גם כתורם/ת.";
  }
  revalidateDonors(d.contact_id);
  revalidatePath("/contacts");
  return { ok: true, message: `התרומה של ${person.full_name} נרשמה.${tagNote}` };
}

// ---------------------------------------------------------------- campaigns

const campaignSchema = z.object({
  name: z.string().trim().min(1, "נא לכתוב שם לקמפיין").max(100, "עד 100 תווים"),
  goal_amount: z.number("נא לכתוב יעד במספרים").positive("היעד חייב להיות גדול מאפס").nullable(),
  starts_on: z.iso.date("תאריך לא תקין").nullable(),
  ends_on: z.iso.date("תאריך לא תקין").nullable(),
  description: z.string().max(1000, "עד 1,000 תווים").nullable(),
});

export async function saveCampaign(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.manageDonors(staff.role)) return { error: "אין לך הרשאה לנהל קמפיינים" };
  const parsed = campaignSchema.safeParse({
    name: String(fd.get("name") ?? ""),
    goal_amount: amount(fd.get("goal_amount")),
    starts_on: opt(fd.get("starts_on")),
    ends_on: opt(fd.get("ends_on")),
    description: opt(fd.get("description")),
  });
  if (!parsed.success) return { error: "יש לתקן את השדות המסומנים", fieldErrors: issues(parsed.error) };
  const c = parsed.data;
  if (c.starts_on && c.ends_on && c.ends_on < c.starts_on) {
    return { error: "יש לתקן את השדות המסומנים", fieldErrors: { ends_on: "תאריך הסיום לפני תאריך ההתחלה" } };
  }
  const supabase = await createClient();
  const id = opt(fd.get("id"));
  const { error } = id
    ? await supabase.from("campaigns").update(c).eq("id", Number(id))
    : await supabase.from("campaigns").insert(c);
  if (error) {
    if (error.code === "23505") return { error: "כבר יש קמפיין בשם הזה", fieldErrors: { name: "השם כבר בשימוש" } };
    return { error: "השמירה נכשלה. נסו שוב." };
  }
  revalidateDonors();
  return { ok: true, message: id ? "הקמפיין עודכן" : "הקמפיין נוסף" };
}

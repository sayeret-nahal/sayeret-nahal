"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/client";
import { NOT_ADMIN, adminSession, intList } from "@/components/admin/guard";
import type { AppRole } from "@/lib/types";

const ROLES = ["admin", "manager", "coordinator", "cohort_lead", "donor_coordinator", "volunteer"] as const;

const nameSchema = z.string().trim().min(2, "נא לכתוב שם מלא").max(80, "עד 80 תווים");
const roleSchema = z.enum(ROLES, { message: "נא לבחור תפקיד" });

function readScope(fd: FormData, role: AppRole) {
  // Scope only matters for cohort / region leads; other roles keep it empty so the data stays clean.
  if (role !== "cohort_lead") return { cohort_scope: [] as number[], region_scope: [] as number[] };
  return { cohort_scope: intList(fd, "cohort_scope"), region_scope: intList(fd, "region_scope") };
}

async function activeAdminCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("staff").select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true);
  return count ?? 0;
}

const LAST_ADMIN = "זה/זו מנהל/ת המערכת הפעיל/ה האחרון/ה. כדי לא לנעול את המערכת, קודם מנו מנהל/ת מערכת נוסף/ת.";

export async function inviteStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await adminSession();
  if (!session) return NOT_ADMIN;
  const fieldErrors: Record<string, string> = {};
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const emailOk = z.email().safeParse(email).success;
  if (!emailOk) fieldErrors.email = "כתובת הדוא״ל לא תקינה";
  const name = nameSchema.safeParse(fd.get("full_name") ?? "");
  if (!name.success) fieldErrors.full_name = name.error.issues[0].message;
  const role = roleSchema.safeParse(fd.get("role"));
  if (!role.success) fieldErrors.role = "נא לבחור תפקיד";
  if (Object.keys(fieldErrors).length || !name.success || !role.success) return { error: "יש לתקן את השדות המסומנים", fieldErrors };

  const scope = readScope(fd, role.data);
  if (role.data === "cohort_lead" && !scope.cohort_scope.length && !scope.region_scope.length) {
    return { error: "יש לבחור לפחות מחזור או אזור אחד", fieldErrors: { scope: "אחראי/ת מחזור או אזור צריך/ה תחום. בלי תחום הוא/היא יראו רק את מי שבאחריותם." } };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("staff").select("id, is_active").eq("email", email).maybeSingle();
  if (existing) {
    return { error: existing.is_active ? "לכתובת הזאת כבר יש משתמש/ת פעיל/ה." : "לכתובת הזאת יש משתמש/ת מושבת/ת. אפשר להפעיל אותו/ה מחדש ברשימת המשתמשים." };
  }
  const { error } = await supabase.from("staff_invites").insert({
    email, full_name: name.data, role: role.data, ...scope, invited_by: session.userId,
  });
  if (error) {
    return { error: error.code === "23505" ? "כבר קיימת הזמנה ממתינה לכתובת הזאת." : "לא הצלחנו לשמור את ההזמנה. נסו שוב." };
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true, message: `ההזמנה ל-${email} נשמרה. עכשיו שלחו לו/ה את הקישור למערכת ואת ההסבר שלמטה.` };
}

export async function cancelInvite(fd: FormData): Promise<void> {
  const session = await adminSession();
  if (!session) return;
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email) return;
  const supabase = await createClient();
  await supabase.from("staff_invites").delete().eq("email", email);
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

export async function updateStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await adminSession();
  if (!session) return NOT_ADMIN;
  const id = String(fd.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "משתמש/ת לא נמצא/ה" };
  const name = nameSchema.safeParse(fd.get("full_name") ?? "");
  const role = roleSchema.safeParse(fd.get("role"));
  if (!name.success || !role.success) {
    return {
      error: "יש לתקן את השדות המסומנים",
      fieldErrors: { ...(!name.success && { full_name: name.error.issues[0].message }), ...(!role.success && { role: "נא לבחור תפקיד" }) },
    };
  }
  const scope = readScope(fd, role.data);
  if (role.data === "cohort_lead" && !scope.cohort_scope.length && !scope.region_scope.length) {
    return { error: "יש לבחור לפחות מחזור או אזור אחד", fieldErrors: { scope: "אחראי/ת מחזור או אזור צריך/ה תחום." } };
  }

  const supabase = await createClient();
  const { data: target } = await supabase.from("staff").select("id, role, is_active").eq("id", id).maybeSingle<{ id: string; role: AppRole; is_active: boolean }>();
  if (!target) return { error: "משתמש/ת לא נמצא/ה" };
  if (target.role === "admin" && target.is_active && role.data !== "admin" && (await activeAdminCount()) <= 1) {
    return { error: LAST_ADMIN };
  }
  const { error } = await supabase.from("staff").update({ full_name: name.data, role: role.data, ...scope }).eq("id", id);
  if (error) return { error: "השמירה נכשלה. נסו שוב." };
  revalidatePath("/admin/users");
  const self = id === session.userId && role.data !== "admin";
  return { ok: true, message: self ? "נשמר. שימו לב: כבר אין לך הרשאות ניהול." : "נשמר. השינוי חל מיד." };
}

export async function setStaffActive(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await adminSession();
  if (!session) return NOT_ADMIN;
  const id = String(fd.get("id") ?? "");
  const activate = fd.get("active") === "true";
  if (!z.uuid().safeParse(id).success) return { error: "משתמש/ת לא נמצא/ה" };
  const supabase = await createClient();
  const { data: target } = await supabase.from("staff").select("id, role, is_active").eq("id", id).maybeSingle<{ id: string; role: AppRole; is_active: boolean }>();
  if (!target) return { error: "משתמש/ת לא נמצא/ה" };
  if (!activate && target.role === "admin" && target.is_active && (await activeAdminCount()) <= 1) {
    return { error: LAST_ADMIN };
  }
  const { error } = await supabase.from("staff").update({ is_active: activate }).eq("id", id);
  if (error) return { error: "הפעולה נכשלה. נסו שוב." };
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true, message: activate ? "החשבון הופעל מחדש." : "החשבון הושבת. הגישה נחסמה מיד." };
}

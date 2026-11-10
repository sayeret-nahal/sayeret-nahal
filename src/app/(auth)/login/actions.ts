"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/client";

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "נא למלא דוא\"ל וסיסמה" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "הדוא\"ל או הסיסמה שגויים" };
  await supabase.rpc("log_access", { p_action: "login", p_table: null, p_record: null, p_details: null });
  redirect(safeNext(String(formData.get("next") ?? "/")));
}

/** Only same-site paths: rejects //host, /\host, control characters and anything that parses to another origin. */
function safeNext(next: string): string {
  if (!/^\/[A-Za-z0-9\-._~/?=&%]*$/.test(next) || next.startsWith("//")) return "/";
  try {
    const u = new URL(next, "http://local.invalid");
    return u.origin === "http://local.invalid" ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
}

export async function signUp(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) return { error: "הסיסמה צריכה להיות באורך 12 תווים לפחות" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/confirm` },
  });
  // same answer for invited and not-invited addresses, so the form does not reveal who is on the staff
  if (error && !/invited|הוזמנו|Database error/i.test(error.message)) {
    return { error: "לא הצלחנו ליצור חשבון. נסו שוב או פנו למנהל/ת המערכת." };
  }
  return { ok: true, message: "אם הכתובת הוזמנה למערכת, נשלח אליה מייל לאימות. אחרי האימות אפשר להתחבר. לא הגיע מייל? פנו למנהל/ת המערכת." };
}

export async function requestPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "נא להקליד את כתובת הדוא״ל" };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/confirm` });
  // same answer whether or not the address exists (no account enumeration)
  return { ok: true, message: "אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה." };
}

const DEMO_ROLES = ["admin", "coordinator", "cohort_lead", "donor_coordinator", "volunteer"] as const;

/**
 * One-click demo login is available in exactly two situations, both with fictional data only:
 *  - the local environment started by `npm run local` (LOCAL_DEMO_LOGIN=1 + a localhost backend);
 *  - a deployment explicitly marked as a public demo (PUBLIC_DEMO=1 + DEMO_PASSWORD set on the server).
 * A real deployment sets neither, so the option does not exist there.
 */
export async function demoLoginEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const local = process.env.LOCAL_DEMO_LOGIN === "1" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  const publicDemo = process.env.PUBLIC_DEMO === "1" && !!process.env.DEMO_PASSWORD;
  return local || publicDemo;
}

async function demoCredentials(role: string): Promise<{ email?: string; password?: string }> {
  if (process.env.PUBLIC_DEMO === "1") {
    return { email: `demo-${role.replace("_", "-")}@example.org`, password: process.env.DEMO_PASSWORD };
  }
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const text = await readFile(join(process.cwd(), ".local", "test-accounts.txt"), "utf8").catch(() => "");
  const line = text.split("\n").find((l) => l.trim().startsWith(role + " "));
  const [, email, password] = line?.trim().split(/\s+/) ?? [];
  return { email, password };
}

/** One-click login as a demo account (see demoLoginEnabled for where this exists). */
export async function demoSignIn(formData: FormData) {
  if (!(await demoLoginEnabled())) redirect("/login");
  const role = String(formData.get("role") ?? "");
  if (!DEMO_ROLES.includes(role as (typeof DEMO_ROLES)[number])) redirect("/login");
  const { email, password } = await demoCredentials(role);
  if (!email || !password) redirect("/login?error=demo");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=demo");
  await supabase.rpc("log_access", { p_action: "login", p_table: null, p_record: null, p_details: { demo: true } });
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.rpc("log_access", { p_action: "logout", p_table: null, p_record: null, p_details: null });
  await supabase.auth.signOut();
  redirect("/login");
}

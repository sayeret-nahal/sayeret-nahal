import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Staff } from "./types";

export interface Session {
  userId: string;
  email: string;
  staff: Staff;
}

/** Current user + staff row + MFA level, once per request. */
export const getAuthState = cache(async () => {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { user: null, staff: null, aal: null, nextAal: null, requireMfa: true } as const;
  const [{ data: staff }, { data: aal }, { data: mfaSetting }] = await Promise.all([
    supabase.from("staff").select("*").eq("id", user.id).maybeSingle<Staff>(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.from("settings").select("value").eq("key", "require_mfa").maybeSingle<{ value: boolean }>(),
  ]);
  return {
    user,
    staff,
    aal: aal?.currentLevel ?? null,
    nextAal: aal?.nextLevel ?? null,
    requireMfa: mfaSetting?.value !== false,
  } as const;
});

/** Use at the top of every staff page and server action. */
export async function requireStaff(): Promise<Session> {
  const s = await getAuthState();
  if (!s.user) redirect("/login");
  if (!s.staff || !s.staff.is_active) redirect("/login?error=not_staff");
  if ((s.requireMfa || s.nextAal === "aal2") && s.aal !== "aal2") redirect("/auth/mfa");
  return { userId: s.user.id, email: s.user.email ?? "", staff: s.staff };
}

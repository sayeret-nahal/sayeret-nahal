import { redirect } from "next/navigation";
import { requireStaff, type Session } from "@/lib/auth";
import { perms } from "@/lib/permissions";

/** For admin pages: active staff with the admin role, otherwise back to the home page. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireStaff();
  if (!perms.admin(session.staff.role)) redirect("/");
  return session;
}

/** For admin server actions: returns the session, or null when the user is not an admin. */
export async function adminSession(): Promise<Session | null> {
  const session = await requireStaff();
  return perms.admin(session.staff.role) ? session : null;
}

export const NOT_ADMIN = { error: "רק מנהל/ת מערכת יכול/ה לבצע את הפעולה הזאת." } as const;

/** Read a list of integer ids from repeated form fields (e.g. checkboxes). */
export function intList(fd: FormData, name: string): number[] {
  return Array.from(new Set(fd.getAll(name).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)));
}

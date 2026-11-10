// Public-demo accounts (supabase/seed/demo-accounts.sql: demo-<role>@example.org) are shared by anyone who
// opens the demo, so they must never reach actions that affect real people, secrets or other accounts.
// The database enforces the same rule once migration 0010 is applied; this is the first layer.
export function isDemoAccount(email: string | null | undefined): boolean {
  return /^demo-[a-z-]+@example\.org$/i.test(email ?? "");
}

export const DEMO_BLOCKED = { error: "בסביבת ההדגמה הפעולה הזאת חסומה." } as const;

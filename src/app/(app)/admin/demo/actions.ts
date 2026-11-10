"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/client";
import { NOT_ADMIN, realAdminSession as adminSession } from "@/components/admin/guard";

// Foreign-key-safe order: donations reference contacts (on delete restrict), so they go first.
// Deleting contacts cascades to care state, interactions, tags, tasks, family links and update links.
const STEPS = [
  { table: "donations", label: "תרומות" },
  { table: "cases", label: "פניות" },
  { table: "events", label: "אירועים" },
  { table: "fallen", label: "נופלים" },
  { table: "contacts", label: "אנשים" },
] as const;

export async function deleteDemoData(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  if (fd.get("confirm") !== "on") return { error: "יש לסמן את תיבת האישור כדי למחוק." };

  const supabase = await createClient();
  const done: string[] = [];
  for (const step of STEPS) {
    const { error, count } = await supabase.from(step.table).delete({ count: "exact" }).eq("is_demo", true);
    if (error) {
      revalidatePath("/", "layout");
      const partial = done.length ? ` כבר נמחקו: ${done.join(", ")}.` : "";
      const hint = step.table === "contacts"
        ? " ייתכן שיש תרומות אמיתיות שמשויכות לאנשי דוגמה, או רשומה אמיתית שאוחדה לתוך רשומת דוגמה. בדקו ונסו שוב."
        : " נסו שוב.";
      return { error: `המחיקה נעצרה בשלב "${step.label}".${partial}${hint}` };
    }
    done.push(`${(count ?? 0).toLocaleString("he-IL")} ${step.label}`);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `נתוני הדוגמה נמחקו: ${done.join(", ")}. המחיקה נרשמה ביומן הפעולות.` };
}

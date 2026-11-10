"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/client";

const pairSchema = z.object({ keep: z.uuid(), drop: z.uuid() });

/** Merge `drop` into `keep` (history moves, `drop` is archived). Database function re-checks the role. */
export async function mergePair(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.mergeContacts(staff.role)) return { error: "רק מנהל/ת עמותה או מנהל/ת מערכת יכולים לאחד רשומות." };
  const parsed = pairSchema.safeParse({ keep: fd.get("keep"), drop: fd.get("drop") });
  if (!parsed.success || parsed.data.keep === parsed.data.drop) return { error: "בקשת איחוד לא תקינה. רעננו את הדף." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_contacts", { p_keep: parsed.data.keep, p_drop: parsed.data.drop });
  if (error) {
    // the database raises Hebrew messages for the expected cases (no permission, already merged)
    const msg = /[֐-׿]/.test(error.message) ? error.message : "האיחוד נכשל. נסו שוב בעוד רגע.";
    return { error: msg };
  }
  revalidatePath("/contacts/quality");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${parsed.data.keep}`);
  return { ok: true, message: "הרשומות אוחדו" };
}

/** Remember that two records are different people, so the pair is not suggested again. */
export async function markNotDuplicate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  if (!perms.reviewDuplicates(staff.role)) return { error: "אין לך הרשאה לסמן כפילויות." };
  const parsed = z.object({ x: z.uuid(), y: z.uuid() }).safeParse({ x: fd.get("a"), y: fd.get("b") });
  if (!parsed.success || parsed.data.x === parsed.data.y) return { error: "בקשה לא תקינה. רעננו את הדף." };
  // the table requires a < b (uuid order = lower-case text order)
  const [a, b] = [parsed.data.x.toLowerCase(), parsed.data.y.toLowerCase()].sort();
  const supabase = await createClient();
  const { error } = await supabase.from("not_duplicates").insert({ a, b });
  if (error && error.code !== "23505") return { error: "השמירה נכשלה. נסו שוב." };
  revalidatePath("/contacts/quality");
  return { ok: true, message: "סומן — הזוג לא יוצע שוב" };
}

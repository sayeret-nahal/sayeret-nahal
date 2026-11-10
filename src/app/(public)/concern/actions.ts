"use server";

import { after } from "next/server";
import { ipAllowed } from "@/lib/rate-limit";
import { BOT_CHECK_FAILED, humanVerified } from "@/lib/turnstile";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { notifyNewPublicCase } from "@/lib/notify";
import { rpcErrorMessage, str, type PublicFormState } from "../_lib/settings";

export async function submitConcern(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const reporterName = str(fd, "reporter_name");
  const reporterPhone = str(fd, "reporter_phone");
  const friendName = str(fd, "friend_name");
  const friendPhone = str(fd, "friend_phone");
  const friendCohort = str(fd, "friend_cohort");
  const message = str(fd, "message");
  const hp = str(fd, "website");

  const fieldErrors: Record<string, string> = {};
  if (reporterName.length < 2) fieldErrors.reporter_name = "נא לכתוב את שמך";
  else if (reporterName.length > 80) fieldErrors.reporter_name = "השם ארוך מדי";
  if (!normalizePhone(reporterPhone)) fieldErrors.reporter_phone = reporterPhone ? "המספר לא נראה תקין. לדוגמה: 052-1234567" : "נא לכתוב טלפון, כדי שנוכל לחזור אליך";
  if (friendName.length < 2) fieldErrors.friend_name = "נא לכתוב את שם החבר/ה";
  else if (friendName.length > 80) fieldErrors.friend_name = "השם ארוך מדי";
  if (friendPhone && !normalizePhone(friendPhone)) fieldErrors.friend_phone = "המספר לא נראה תקין. אפשר גם להשאיר ריק";
  if (friendCohort.length > 80) fieldErrors.friend_cohort = "עד 80 תווים";
  if (message.length > 2000) fieldErrors.message = "עד 2,000 תווים";
  if (Object.keys(fieldErrors).length) return { error: "חסר משהו קטן — מסומן למעלה.", fieldErrors };

  const supabase = await createClient();
  if (!(await humanVerified(fd.get("cf-turnstile-response")))) return { error: BOT_CHECK_FAILED };
  if (!(await ipAllowed("concern"))) {
    return { error: "נשלחו כבר כמה פניות מהמכשיר הזה. נסו שוב בעוד כמה דקות. אם יש סכנה מיידית — חייגו 101, ולתמיכה נפשית מיידית ער״ן 1201." };
  }
  const { data, error } = await supabase.rpc("submit_concern", {
    p_reporter_name: reporterName,
    p_reporter_phone: reporterPhone,
    p_subject_name: friendName,
    p_subject_phone: friendPhone || null,
    p_subject_cohort: friendCohort || null,
    p_message: message || null,
    p_hp: hp || null,
  });
  if (error) return { error: rpcErrorMessage(error) };

  const ref = Number(data) || 0; // 0 = ignored (honeypot)
  if (ref > 0) {
    after(async () => {
      try {
        // only the reporter's first name goes into the e-mail, never the friend's details
        await notifyNewPublicCase({ ref, kind: "concern", name: reporterName });
      } catch {
        // the report is saved; a failed e-mail must not affect the person
      }
    });
  }
  return { ok: true, ref: ref > 0 ? ref : null };
}

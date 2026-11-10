"use server";

import { after } from "next/server";
import { ipAllowed } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { notifyNewPublicCase } from "@/lib/notify";
import { rpcErrorMessage, str, type PublicFormState } from "../_lib/settings";

const CHANNELS = ["phone", "whatsapp", "sms"];

export async function submitTalk(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const name = str(fd, "name");
  const phone = str(fd, "phone");
  const channel = str(fd, "channel");
  const preferredTime = str(fd, "preferred_time");
  const message = str(fd, "message");
  const hp = str(fd, "website");

  // Friendly field-level checks first (the database checks the same things again).
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "נא לכתוב שם (אפשר גם רק שם פרטי)";
  else if (name.length > 80) fieldErrors.name = "השם ארוך מדי";
  if (!normalizePhone(phone)) fieldErrors.phone = phone ? "המספר לא נראה תקין. לדוגמה: 052-1234567" : "נא לכתוב מספר טלפון כדי שנוכל לחזור אליך";
  if (!CHANNELS.includes(channel)) fieldErrors.channel = "נא לבחור איך נוח שנחזור אליך";
  if (preferredTime.length > 200) fieldErrors.preferred_time = "עד 200 תווים";
  if (message.length > 2000) fieldErrors.message = "עד 2,000 תווים";
  if (Object.keys(fieldErrors).length) return { error: "חסר משהו קטן — מסומן למעלה.", fieldErrors };

  const supabase = await createClient();
  if (!(await ipAllowed("talk"))) {
    return { error: "נשלחו כבר כמה פניות מהמכשיר הזה. נסו שוב בעוד כמה דקות. אם יש סכנה מיידית — חייגו 101, ולתמיכה נפשית מיידית ער״ן 1201." };
  }
  const { data, error } = await supabase.rpc("submit_talk_request", {
    p_name: name,
    p_phone: phone,
    p_channel: channel,
    p_preferred_time: preferredTime || null,
    p_message: message || null,
    p_hp: hp || null,
  });
  if (error) return { error: rpcErrorMessage(error) };

  const ref = Number(data) || 0; // 0 = ignored (honeypot)
  if (ref > 0) {
    after(async () => {
      try {
        await notifyNewPublicCase({ ref, kind: "request", name });
      } catch {
        // the request is saved; a failed e-mail must not affect the person
      }
    });
  }
  return { ok: true, ref: ref > 0 ? ref : null };
}

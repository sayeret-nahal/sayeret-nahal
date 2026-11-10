"use server";

import { after } from "next/server";
import { ipAllowed } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { notifyNewPublicCase } from "@/lib/notify";
import { rpcErrorMessage, str, type PublicFormState } from "../_lib/settings";

export async function submitInquiry(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const topic = str(fd, "topic");
  const name = str(fd, "name");
  const phone = str(fd, "phone");
  const email = str(fd, "email");
  const message = str(fd, "message");
  const consent = fd.get("consent") === "on";
  const page = str(fd, "page");
  const hp = str(fd, "website");

  const fieldErrors: Record<string, string> = {};
  if (!topic) fieldErrors.topic = "נא לבחור נושא";
  if (name.length < 2) fieldErrors.name = "נא לכתוב שם";
  else if (name.length > 80) fieldErrors.name = "השם ארוך מדי";
  if (!normalizePhone(phone)) fieldErrors.phone = phone ? "המספר לא נראה תקין. לדוגמה: 052-1234567" : "נא לכתוב טלפון כדי שנוכל לחזור אליך";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = "כתובת הדוא״ל לא תקינה";
  if (message.length < 2) fieldErrors.message = "נא לכתוב בקצרה במה אפשר לעזור";
  else if (message.length > 2000) fieldErrors.message = "עד 2,000 תווים";
  if (Object.keys(fieldErrors).length) return { error: "חסר משהו קטן — מסומן למעלה.", fieldErrors };

  if (!(await ipAllowed("inquiry"))) return { error: "נשלחו כבר כמה פניות מהמכשיר הזה. נסו שוב בעוד כמה דקות." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_inquiry", {
    p_topic: topic, p_name: name, p_phone: phone, p_email: email || null, p_message: message,
    p_consent: consent, p_page: page || null, p_hp: hp || null,
  });
  if (error) return { error: rpcErrorMessage(error) };
  const ref = Number(data) || 0;
  if (ref > 0) after(() => notifyNewPublicCase({ ref, kind: "request", name }).catch(() => undefined));
  return { ok: true, ref: ref > 0 ? ref : null };
}

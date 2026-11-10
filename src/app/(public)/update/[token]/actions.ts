"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { rpcErrorMessage, str, type PublicFormState } from "../../_lib/settings";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseSkills(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,\n،;]/).map((s) => s.trim().slice(0, 40)).filter(Boolean))).slice(0, 20);
}

export async function submitUpdate(_: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const token = str(fd, "token");
  if (!token || token.length > 200) return { error: "הקישור אינו בתוקף. אפשר לבקש קישור חדש מהעמותה." };

  const firstName = str(fd, "first_name");
  const lastName = str(fd, "last_name");
  const phone = str(fd, "phone");
  const email = str(fd, "email").toLowerCase();
  const city = str(fd, "city");
  const regionId = str(fd, "region_id");
  const profession = str(fd, "profession");
  const skillsRaw = str(fd, "skills");
  const skills = parseSkills(skillsRaw);

  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.first_name = "נא לכתוב שם פרטי";
  if (firstName.length > 60) fieldErrors.first_name = "עד 60 תווים";
  if (lastName.length > 60) fieldErrors.last_name = "עד 60 תווים";
  if (phone && !normalizePhone(phone)) fieldErrors.phone = "המספר לא נראה תקין. לדוגמה: 052-1234567";
  if (email && !EMAIL_RE.test(email)) fieldErrors.email = "כתובת הדוא״ל לא נראית תקינה";
  if (city.length > 60) fieldErrors.city = "עד 60 תווים";
  if (profession.length > 80) fieldErrors.profession = "עד 80 תווים";
  if (skillsRaw.split(/[,\n،;]/).filter((s) => s.trim()).length > 20) fieldErrors.skills = "עד 20 כישורים";
  if (regionId && !/^\d+$/.test(regionId)) fieldErrors.region_id = "נא לבחור מהרשימה";
  if (Object.keys(fieldErrors).length) return { error: "יש לתקן את השדות המסומנים.", fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_update_profile", {
    p_token: token,
    p_data: {
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      city,
      region_id: regionId || null,
      profession,
      skills,
      available_to_help: fd.get("available_to_help") === "on",
      skills_share_consent: fd.get("skills_share_consent") === "on",
      campaign_consent: fd.get("campaign_consent") === "on",
    },
  });
  if (error) return { error: rpcErrorMessage(error, "השמירה לא הצליחה. נסו שוב בעוד רגע.") };
  return { ok: true };
}

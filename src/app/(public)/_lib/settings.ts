import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface PublicSettings {
  org_name?: string;
  talk_response_text?: string;
  emergency_text?: string;
  privacy_notice_text?: string;
  privacy_notice_version?: string;
  talk_response_hours?: number;
}

/** Texts for the public forms (anon RPC; once per request). Empty object if unavailable. */
export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_form_settings");
  if (error || !data || typeof data !== "object") return {};
  const s = data as Record<string, unknown>;
  const str = (k: string) => (typeof s[k] === "string" && (s[k] as string).trim() ? (s[k] as string) : undefined);
  return {
    org_name: str("org_name"),
    talk_response_text: str("talk_response_text"),
    emergency_text: str("emergency_text"),
    privacy_notice_text: str("privacy_notice_text"),
    privacy_notice_version: str("privacy_notice_version"),
    talk_response_hours: typeof s.talk_response_hours === "number" ? s.talk_response_hours : undefined,
  };
});

/** Answer for public form actions. */
export interface PublicFormState {
  ok?: boolean;
  ref?: number | null;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export const GENERIC_ERROR = "משהו השתבש והפנייה לא נשלחה. נסו שוב בעוד רגע. אם זה דחוף, השתמשו במספרים שלמעלה.";

/** Errors our database functions raise on purpose (errcode P0001) are Hebrew sentences meant for the user. */
export function rpcErrorMessage(error: { code?: string; message?: string } | null, fallback = GENERIC_ERROR): string {
  if (error?.code === "P0001" && error.message) return error.message;
  return fallback;
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

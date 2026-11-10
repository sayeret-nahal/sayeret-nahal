// Server-side check of Cloudflare Turnstile (bot protection) on the public forms.
// Off until both keys are set: NEXT_PUBLIC_TURNSTILE_SITE_KEY (browser) and TURNSTILE_SECRET_KEY (server).
import { clientIp } from "./rate-limit";

export const turnstileEnabled = () => !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const BOT_CHECK_FAILED = "לא הצלחנו לוודא שהשליחה נעשתה על ידי אדם. רעננו את הדף ונסו שוב.";

/** true when Turnstile is off, or the token is valid. */
export async function humanVerified(token: FormDataEntryValue | unknown): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, remoteip: await clientIp() });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false; // fail closed: the person can retry; a bot cannot get through when the check is down
  }
}

// Server-only. 019 (docs.019sms.co.il): WhatsApp template messages and SMS.
//   Auth: Authorization: Bearer <API token> (created in 019's web app: הגדרות → ניהול Token API)
//   WhatsApp: POST https://019sms.co.il/whatsapp-api/send-whatsapp-template
//             { source, destination (972…, no "+"), templateId, dynamicFieldsObject: {"1": …, "5": …} }
//   SMS:      POST https://019sms.co.il/api   (dry run: /api/test)
// Templates must be created and approved (by Meta) on 019's site; the CRM stores only their id.

export type SendResult = { ok: boolean; messageId?: string; error?: string };

export const sms019Configured = () => !!process.env.SMS019_TOKEN && !!(process.env.SMS019_WA_PHONE || process.env.SMS019_SMS_SOURCE);
export const whatsappConfigured = () => !!process.env.SMS019_TOKEN && !!process.env.SMS019_WA_PHONE;
export const smsConfigured = () => !!process.env.SMS019_TOKEN && !!process.env.SMS019_SMS_SOURCE && !!process.env.SMS019_USERNAME;

const to972 = (e164: string) => e164.replace(/^\+/, "");
const toLocal = (e164: string) => e164.replace(/^\+972/, "0");

async function call(url: string, body: unknown, timeoutMs = 15_000): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SMS019_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const pickId = (j: Record<string, unknown> | null): string | undefined => {
  if (!j) return undefined;
  for (const k of ["message_id", "messageId", "id", "msgId", "shipment_id", "wamid"]) {
    const v = j[k] ?? (j.data as Record<string, unknown> | undefined)?.[k];
    if (v !== undefined && v !== null && String(v)) return String(v);
  }
  return undefined;
};

export async function sendWhatsAppTemplate(phoneE164: string, templateId: string, vars: string[]): Promise<SendResult> {
  if (!whatsappConfigured()) return { ok: false, error: "019 WhatsApp is not configured" };
  const dynamicFieldsObject = Object.fromEntries(vars.slice(0, 5).map((v, i) => [String(i + 1), v]));
  try {
    const r = await call("https://019sms.co.il/whatsapp-api/send-whatsapp-template", {
      source: process.env.SMS019_WA_PHONE,
      destination: to972(phoneE164),
      templateId,
      dynamicFieldsObject,
    });
    const status = String(r.json?.status ?? "");
    const ok = r.status >= 200 && r.status < 300 && (status === "" || status === "0" || /success|ok|sent/i.test(status));
    return ok ? { ok, messageId: pickId(r.json) } : { ok: false, error: `${r.status} ${r.text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendSms(phoneE164: string, message: string, opts: { test?: boolean; id?: string } = {}): Promise<SendResult> {
  if (!smsConfigured()) return { ok: false, error: "019 SMS is not configured" };
  try {
    const r = await call(`https://019sms.co.il/api${opts.test ? "/test" : ""}`, {
      sms: {
        user: { username: process.env.SMS019_USERNAME },
        source: process.env.SMS019_SMS_SOURCE,
        destinations: { phone: [{ _: toLocal(phoneE164), ...(opts.id ? { id: opts.id } : {}) }] },
        message: message.slice(0, 1005),
        add_unsubscribe: 2, // removal by replying to the SMS (required for marketing messages)
      },
    });
    const status = String(r.json?.status ?? "");
    const ok = r.status >= 200 && r.status < 300 && (status === "0" || status === "");
    return ok ? { ok, messageId: pickId(r.json) ?? opts.id } : { ok: false, error: `${r.status} ${r.text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fills {{1}}..{{5}} for previews and SMS. */
export function fillTemplate(body: string, vars: string[]): string {
  return body.replace(/\{\{\s*(\d)\s*\}\}/g, (_, i) => vars[Number(i) - 1] ?? "");
}

"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { adminSession, NOT_ADMIN } from "@/components/admin/guard";
import type { ActionState } from "@/components/ui/client";
import { createClient } from "@/lib/supabase/server";
import { decodeText, extractTable, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseCsv, sheetToGrid } from "@/lib/import";
import { ingestClient, ingestSecret } from "@/lib/integrations/ingest";
import { fromNexus, fromPaymentRow } from "@/lib/integrations/normalize";
import { sendSms, sendWhatsAppTemplate, smsConfigured, whatsappConfigured } from "@/lib/integrations/sms019";

/** Stores the hash of INGEST_SECRET in the database, so webhooks and the sender are accepted. */
export async function syncIngestSecret(): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const secret = ingestSecret();
  if (!secret) return { error: "חסר משתנה הסביבה INGEST_SECRET בשרת (לפחות 32 תווים)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ingest_secret", { p_secret: secret });
  if (error) return { error: "העדכון נכשל. נסו שוב." };
  revalidatePath("/admin/integrations");
  return { ok: true, message: "המפתח עודכן. החיבורים פעילים." };
}

/** Imports a payments export (JGive / Grow) or a consumer-club report (Nexus). Same rules as the webhooks. */
export async function importReport(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminSession())) return NOT_ADMIN;
  const secret = ingestSecret();
  if (!secret) return { error: "החיבורים עוד לא הוגדרו בשרת (INGEST_SECRET)." };
  const provider = String(fd.get("provider") ?? "");
  if (!["jgive", "grow", "nexus"].includes(provider)) return { error: "נא לבחור מקור" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "לא נבחר קובץ" };
  if (file.size > IMPORT_MAX_BYTES) return { error: "הקובץ גדול מ-5MB. פצלו אותו." };
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let grid: string[][];
  if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    } catch {
      return { error: "לא הצלחנו לקרוא את קובץ האקסל. שמרו אותו מחדש כ-xlsx ונסו שוב." };
    }
    const ws = wb.worksheets.find((w) => w.state !== "hidden" && w.state !== "veryHidden") ?? wb.worksheets[0];
    if (!ws) return { error: "בקובץ אין גיליונות" };
    grid = sheetToGrid(ws);
  } else if (/\.(csv|tsv|txt)$/.test(name)) {
    grid = parseCsv(decodeText(bytes));
  } else {
    return { error: "אפשר להעלות xlsx או CSV" };
  }
  const table = extractTable(grid);
  if (!table.rows.length) return { error: "לא נמצאו שורות בקובץ" };
  if (table.rows.length > IMPORT_MAX_ROWS) return { error: `עד ${IMPORT_MAX_ROWS.toLocaleString("he-IL")} שורות בקובץ אחד` };

  const db = ingestClient();
  const counts = { processed: 0, duplicate: 0, error: 0, skipped: 0 };
  for (const r of table.rows) {
    const row = Object.fromEntries(table.headers.map((h, i) => [h, r.cells[i] ?? ""]));
    const ev = provider === "nexus" ? fromNexus(row) : fromPaymentRow(provider as "jgive" | "grow", row);
    if (!ev) {
      counts.skipped++;
      continue;
    }
    const { data, error } = provider === "nexus"
      ? await db.rpc("ingest_benefit_usage", { p_secret: secret, p_provider: "nexus", p_event: ev })
      : await db.rpc("ingest_payment", { p_secret: secret, p_provider: provider, p_event: ev });
    const status = error ? "error" : ((data as { status?: string })?.status ?? "error");
    if (status === "processed") counts.processed++;
    else if (status === "duplicate") counts.duplicate++;
    else counts.error++;
  }
  revalidatePath("/admin/integrations");
  return {
    ok: true,
    message: `נקלטו ${counts.processed} · כבר היו במערכת ${counts.duplicate} · שגיאות ${counts.error} · שורות בלי מזהה/טלפון/דוא״ל ${counts.skipped}`,
  };
}

/** Sends one test message to a number the admin types (their own phone). */
export async function testSend(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await adminSession();
  if (!s) return NOT_ADMIN;
  const { normalizePhone } = await import("@/lib/phone");
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!phone) return { error: "מספר טלפון לא תקין" };
  const channel = String(fd.get("channel") ?? "");
  if (channel === "whatsapp") {
    if (!whatsappConfigured()) return { error: "וואטסאפ דרך 019 עוד לא הוגדר" };
    const template = String(fd.get("template") ?? "").trim();
    if (!template) return { error: "נא לכתוב את מזהה התבנית מ-019" };
    const r = await sendWhatsAppTemplate(phone, template, [s.staff.full_name.split(" ")[0] ?? ""]);
    return r.ok ? { ok: true, message: "נשלח. בדקו את הוואטסאפ." } : { error: `השליחה נכשלה: ${r.error}` };
  }
  if (!smsConfigured()) return { error: "SMS דרך 019 עוד לא הוגדר" };
  const r = await sendSms(phone, "בדיקת חיבור ממערכת ה-CRM של העמותה", { test: fd.get("dry") === "on" });
  return r.ok ? { ok: true, message: fd.get("dry") === "on" ? "בדיקה יבשה עברה (לא נשלחה הודעה)." : "נשלח. בדקו את ההודעות." } : { error: `השליחה נכשלה: ${r.error}` };
}

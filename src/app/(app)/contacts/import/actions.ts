"use server";

import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, MODE_FIELDS, countStatuses, decodeText, extractTable, guessMapping,
  normalizeContactRow, normalizeDonationRow, normalizeLabel, parseCsv, planContacts, planDonations, sampleValues, sheetToGrid,
  type ContactPlan, type DonationPlan, type ExistingContact, type ExistingDonation, type ImportField, type ImportMode,
  type Mapping, type PlanRow, type Table,
} from "@/lib/import";
import type { AppRole } from "@/lib/types";
import type { CommitResult, Fail, ImportOptions, ParsedFile, PreviewResult } from "@/components/import/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const CONTACT_COLS = "id,first_name,last_name,phone,email,cohort_id,region_id,city,profession,notes,owner_id,archived_at";
const IN_CHUNK = 150;
const WRITE_CHUNK = 500;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Run async jobs with limited concurrency. */
async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await job(items[i]);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Reading the uploaded file
// ---------------------------------------------------------------------------

type Upload = { name: string; bytes: Uint8Array; fingerprint: string };

async function readUpload(fd: FormData): Promise<Upload | Fail> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "לא נבחר קובץ, או שהקובץ ריק." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: "הקובץ גדול מ-5MB. פצלו אותו לכמה קבצים קטנים יותר." };
  const name = file.name.slice(0, 200);
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xls") return { ok: false, error: "קובצי xls ישנים אינם נתמכים. פתחו את הקובץ באקסל ושמרו אותו כ-xlsx או CSV." };
  if (!["xlsx", "csv", "tsv", "txt"].includes(ext)) return { ok: false, error: "אפשר לייבא קובצי xlsx או CSV בלבד." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name, bytes, fingerprint: createHash("sha256").update(bytes).digest("hex") };
}

async function fileToTable(up: Upload): Promise<{ table: Table; sheetName: string | null } | Fail> {
  let grid: string[][];
  let sheetName: string | null = null;
  if (up.name.toLowerCase().endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(up.bytes) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    } catch {
      return { ok: false, error: "לא הצלחנו לקרוא את קובץ האקסל. ודאו שהוא לא מוגן בסיסמה ונסו לשמור אותו מחדש." };
    }
    const ws = wb.worksheets.find((w) => w.state !== "hidden" && w.state !== "veryHidden") ?? wb.worksheets[0];
    if (!ws) return { ok: false, error: "בקובץ אין גיליונות." };
    sheetName = ws.name;
    grid = sheetToGrid(ws);
  } else {
    grid = parseCsv(decodeText(up.bytes));
  }
  const table = extractTable(grid);
  if (!table.headers.length || !table.rows.length) return { ok: false, error: "לא מצאנו שורות נתונים בקובץ. ודאו שבשורה הראשונה יש כותרות ומתחתיה הנתונים." };
  if (table.rows.length > IMPORT_MAX_ROWS) return { ok: false, error: `בקובץ יותר מ-${IMPORT_MAX_ROWS.toLocaleString("he-IL")} שורות. פצלו אותו לכמה קבצים.` };
  return { table, sheetName };
}

function canUseMode(role: AppRole, mode: ImportMode): boolean {
  return perms.importData(role) && (mode === "contacts" || perms.manageDonors(role));
}

function readMode(fd: FormData): ImportMode {
  return fd.get("mode") === "donations" ? "donations" : "contacts";
}

/** Step 1: read the file and return headers, samples and a suggested mapping. Nothing is written. */
export async function parseImportFile(fd: FormData): Promise<ParsedFile | Fail> {
  const { staff } = await requireStaff();
  const mode = readMode(fd);
  if (!canUseMode(staff.role, mode)) return { ok: false, error: "אין לך הרשאה לייבוא מהסוג הזה." };
  const up = await readUpload(fd);
  if ("ok" in up) return up;
  const t = await fileToTable(up);
  if ("ok" in t) return t;
  const { table, sheetName } = t;
  return {
    ok: true,
    fileName: up.name,
    fingerprint: up.fingerprint,
    sheetName,
    headerRow: table.headerRow,
    headers: table.headers,
    samples: sampleValues(table.rows, table.headers.length),
    rowCount: table.rows.length,
    mapping: guessMapping(table.headers, mode),
  };
}

// ---------------------------------------------------------------------------
// Building the plan (shared by preview and commit)
// ---------------------------------------------------------------------------

const optionsSchema = z.object({
  typeCode: z.string().max(40),
  defaultCohortId: z.number().int().nullable(),
  defaultRegionId: z.number().int().nullable(),
  defaultOwnerId: z.uuid().nullable(),
  sourceNote: z.string().max(200),
});

function readJson(fd: FormData, key: string): unknown {
  try {
    return JSON.parse(String(fd.get(key) ?? "null"));
  } catch {
    return null;
  }
}

function validateMapping(raw: unknown, headers: number, mode: ImportMode): Mapping | string {
  if (!Array.isArray(raw) || raw.length !== headers) return "התאמת העמודות לא תואמת לקובץ. התחילו מחדש.";
  const allowed = new Set<string>(MODE_FIELDS[mode]);
  const seen = new Set<string>();
  for (const v of raw) {
    if (v === null) continue;
    if (typeof v !== "string" || !allowed.has(v)) return "התאמת עמודות לא תקינה.";
    if (seen.has(v)) return "אותו שדה נבחר ליותר מעמודה אחת.";
    seen.add(v);
  }
  const m = raw as Mapping;
  const has = (f: ImportField) => m.includes(f);
  if (mode === "contacts" && !has("first_name") && !has("full_name")) return "יש לבחור עמודה של שם (שם פרטי או שם מלא).";
  if (mode === "donations") {
    if (!has("amount")) return "יש לבחור את עמודת הסכום.";
    if (!has("date")) return "יש לבחור את עמודת התאריך.";
    if (!has("phone") && !has("email") && !has("full_name") && !has("first_name")) return "יש לבחור עמודה לזיהוי התורם/ת: טלפון, דוא״ל או שם.";
  }
  return m;
}

async function fetchExisting(supabase: Supabase, phones: string[], emails: string[]): Promise<ExistingContact[]> {
  const found = new Map<string, ExistingContact>();
  const run = async (col: "phone" | "email", values: string[]) => {
    for (const part of chunks([...new Set(values)], IN_CHUNK)) {
      const { data, error } = await supabase.from("contacts").select(CONTACT_COLS)
        .is("merged_into", null).in(col, part).order("created_at").returns<ExistingContact[]>();
      if (error) throw new Error(error.message);
      for (const c of data ?? []) if (!found.has(c.id)) found.set(c.id, c);
    }
  };
  await run("phone", phones);
  await run("email", emails);
  // active records first, then archived, oldest first inside each group (planContacts keeps the first per phone / e-mail)
  return [...found.values()].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));
}

async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Ctx = {
  supabase: Supabase;
  userId: string;
  role: AppRole;
  mode: ImportMode;
  upload: Upload;
  options: ImportOptions;
  lookups: Awaited<ReturnType<typeof getLookups>>;
};

type Built =
  | { mode: "contacts"; ctx: Ctx; plan: ContactPlan; total: number }
  | { mode: "donations"; ctx: Ctx; plan: DonationPlan; total: number; campaigns: { id: number; name: string }[] };

async function build(fd: FormData): Promise<Built | Fail> {
  const { staff, userId } = await requireStaff();
  const mode = readMode(fd);
  if (!canUseMode(staff.role, mode)) return { ok: false, error: "אין לך הרשאה לייבוא מהסוג הזה." };
  const up = await readUpload(fd);
  if ("ok" in up) return up;
  const expected = String(fd.get("fingerprint") ?? "");
  if (expected && expected !== up.fingerprint) return { ok: false, error: "הקובץ השתנה מאז שנבדק. העלו אותו שוב." };
  const t = await fileToTable(up);
  if ("ok" in t) return t;
  const mapping = validateMapping(readJson(fd, "mapping"), t.table.headers.length, mode);
  if (typeof mapping === "string") return { ok: false, error: mapping };
  const parsedOptions = optionsSchema.safeParse(readJson(fd, "options"));
  if (!parsedOptions.success) return { ok: false, error: "האפשרויות שנבחרו לא תקינות. רעננו את הדף ונסו שוב." };
  const options = parsedOptions.data;

  const lookups = await getLookups();
  const seeCare = perms.seeCare(staff.role);
  if (options.typeCode) {
    const t = lookups.types.find((x) => x.code === options.typeCode);
    if (!t || (t.is_sensitive && !seeCare)) return { ok: false, error: "סוג הקשר שנבחר לא זמין." };
  }
  if (options.defaultCohortId !== null && !lookups.cohorts.some((c) => c.id === options.defaultCohortId)) return { ok: false, error: "המחזור שנבחר לא קיים." };
  if (options.defaultRegionId !== null && !lookups.regions.some((c) => c.id === options.defaultRegionId)) return { ok: false, error: "האזור שנבחר לא קיים." };
  if (options.defaultOwnerId !== null && !lookups.staff.some((s) => s.id === options.defaultOwnerId)) return { ok: false, error: "האחראי/ת שנבחר/ה לא פעיל/ה." };
  // Donor staff only see donors and records they own: new people are assigned to them at commit so they stay
  // visible (and can be tagged); existing records keep their owner.
  if (staff.role === "donor_coordinator") options.defaultOwnerId = null;

  const supabase = await createClient();
  const ctx: Ctx = { supabase, userId, role: staff.role, mode, upload: up, options, lookups };
  try {
    if (mode === "contacts") {
      const rows = t.table.rows.map((r) => normalizeContactRow(r, mapping));
      const existing = await fetchExisting(supabase, rows.flatMap((r) => (r.phone ? [r.phone] : [])), rows.flatMap((r) => (r.email ? [r.email] : [])));
      const plan = planContacts(rows, existing, {
        cohorts: lookups.cohorts, regions: lookups.regions,
        defaultCohortId: options.defaultCohortId, defaultRegionId: options.defaultRegionId,
        defaultOwnerId: options.defaultOwnerId, sourceNote: options.sourceNote.trim(),
      });
      return { mode, ctx, plan, total: rows.length };
    }
    const rows = t.table.rows.map((r) => normalizeDonationRow(r, mapping));
    const existing = await fetchExisting(supabase, rows.flatMap((r) => (r.phone ? [r.phone] : [])), rows.flatMap((r) => (r.email ? [r.email] : [])));
    const refs = [...new Set(rows.flatMap((r) => (r.external_ref ? [r.external_ref] : [])))];
    const donations: ExistingDonation[] = [];
    for (const part of chunks(refs, IN_CHUNK)) {
      const { data, error } = await supabase.from("donations").select("contact_id,donated_at,amount,external_ref").in("external_ref", part);
      if (error) throw new Error(error.message);
      donations.push(...((data ?? []) as ExistingDonation[]));
    }
    // same donor + date + amount check for rows without a reference
    const ids = existing.map((c) => c.id);
    for (const part of chunks(ids, IN_CHUNK)) {
      donations.push(...(await fetchAllPages<ExistingDonation>((from, to) =>
        supabase.from("donations").select("contact_id,donated_at,amount,external_ref").in("contact_id", part).order("id").range(from, to))));
    }
    const { data: campaigns, error } = await supabase.from("campaigns").select("id,name");
    if (error) throw new Error(error.message);
    const plan = planDonations(rows, existing, donations, campaigns ?? []);
    return { mode, ctx, plan, total: rows.length, campaigns: campaigns ?? [] };
  } catch {
    return { ok: false, error: "לא הצלחנו לבדוק את הנתונים מול המערכת. נסו שוב בעוד רגע." };
  }
}

/** Only what the browser needs (no insert payloads). */
function lean(r: PlanRow): PlanRow {
  return {
    row: r.row, status: r.status, name: r.name, phone: r.phone, email: r.email, reason: r.reason, warnings: r.warnings,
    amount: r.amount, date: r.date, ref: r.ref, contactId: r.contactId ?? null,
  };
}

/** Step 3: compute what will happen to every row. Nothing is written. */
export async function previewImport(fd: FormData): Promise<PreviewResult | Fail> {
  const b = await build(fd);
  if ("ok" in b) return b;
  const rows = b.plan.rows;
  return {
    ok: true,
    mode: b.mode,
    fileName: b.ctx.upload.name,
    fingerprint: b.ctx.upload.fingerprint,
    total: b.total,
    counts: countStatuses(rows),
    updatesWithChanges: b.mode === "contacts" ? b.plan.rows.filter((r) => r.status === "update" && r.patch).length : 0,
    warnings: rows.filter((r) => r.warnings.length).length,
    rows: rows.map(lean),
    unknownCohorts: b.mode === "contacts" ? b.plan.unknownCohorts : [],
    unknownRegions: b.mode === "contacts" ? b.plan.unknownRegions : [],
    newCampaigns: b.mode === "donations" ? b.plan.newCampaigns : [],
    unmatchedDonors: b.mode === "donations" ? b.plan.unmatchedDonors : 0,
    canCreateCohorts: perms.admin(b.ctx.role),
    limitedVisibility: !["admin", "manager", "coordinator"].includes(b.ctx.role),
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

const SAVE_FAILED = "השמירה נכשלה (ייתכן שחסרה הרשאה או שיש ערך לא תקין)";

/** Insert rows in chunks; when a chunk fails, retry one by one so a single bad row does not sink the rest. */
async function insertRows<T extends { id: string }>(supabase: Supabase, table: string, rows: T[]): Promise<{ ok: Set<string>; failed: Map<string, string> }> {
  const ok = new Set<string>();
  const failed = new Map<string, string>();
  for (const part of chunks(rows, WRITE_CHUNK)) {
    const { error } = await supabase.from(table).insert(part);
    if (!error) { part.forEach((r) => ok.add(r.id)); continue; }
    for (const r of part) {
      const { error: e } = await supabase.from(table).insert(r);
      if (e) failed.set(r.id, SAVE_FAILED);
      else ok.add(r.id);
    }
  }
  return { ok, failed };
}

async function tagContacts(supabase: Supabase, ids: string[], typeCode: string): Promise<boolean> {
  let ok = true;
  for (const part of chunks([...new Set(ids)], WRITE_CHUNK)) {
    const { error } = await supabase.from("contact_type_links")
      .upsert(part.map((id) => ({ contact_id: id, type_code: typeCode })), { ignoreDuplicates: true });
    if (error) ok = false;
  }
  return ok;
}

function skippedReason(r: PlanRow, createDonors: boolean): string {
  if (r.status === "unmatched" && !createDonors) return `${r.reason} — בחרת לא ליצור אנשי קשר חדשים`;
  return r.reason;
}

/** Step 4: write. Re-reads the file and re-checks everything against the database right before writing. */
export async function commitImport(fd: FormData): Promise<CommitResult | Fail> {
  if (fd.get("confirm") !== "yes") return { ok: false, error: "יש לאשר את הייבוא." };
  if (!fd.get("fingerprint")) return { ok: false, error: "יש לבדוק את הקובץ לפני הייבוא." };
  const b = await build(fd);
  if ("ok" in b) return b;
  const { supabase, userId, role, options, upload } = b.ctx;
  const batchId = randomUUID();
  const { error: batchError } = await supabase.from("import_batches").insert({
    id: batchId, kind: b.mode, file_name: upload.name, rows_total: b.total, report: { status: "in_progress" },
  });
  if (batchError) return { ok: false, error: "לא הצלחנו להתחיל את הייבוא. ייתכן שאין לך הרשאה." };

  const result: CommitResult = {
    ok: true, mode: b.mode, batchId, total: b.total, created: 0, updated: 0, unchanged: 0, skipped: 0,
    donationsCreated: 0, donorsCreated: 0, campaignsCreated: [], cohortsCreated: [], skippedRows: [], touched: [],
    listHref: null, partialError: null,
  };
  const skipped: PlanRow[] = [];
  const createdIds: string[] = [];
  const matchedIds: string[] = [];

  try {
    if (b.mode === "contacts") {
      const plan = b.plan;
      // 1. cohorts that do not exist yet (admin only, when asked)
      const cohortIds = new Map<string, number>();
      const unknown = [...new Set(plan.rows.flatMap((r) => (r.newCohort ? [r.newCohort.trim()] : [])))];
      if (fd.get("createCohorts") === "yes" && perms.admin(role) && unknown.length) {
        const byKey = new Map<string, string>();
        for (const label of unknown) {
          const k = normalizeLabel(label).replace(/^מחזור\s+/, "");
          if (!byKey.has(k)) byKey.set(k, label.slice(0, 80));
        }
        const { data, error } = await supabase.from("cohorts").insert([...byKey.values()].map((label) => ({ label }))).select("id,label");
        if (error) result.partialError = "לא הצלחנו ליצור את המחזורים החדשים; השדה נשאר ריק.";
        for (const c of data ?? []) {
          cohortIds.set(normalizeLabel(c.label).replace(/^מחזור\s+/, ""), c.id);
          result.cohortsCreated.push(c.label);
        }
      }
      const cohortFor = (label?: string) => (label ? cohortIds.get(normalizeLabel(label).replace(/^מחזור\s+/, "")) ?? null : null);

      // 2. new people
      const inserts = plan.rows.filter((r) => r.status === "new" && r.insert).map((r) => ({
        planRow: r,
        record: {
          id: randomUUID(),
          ...r.insert!,
          cohort_id: r.insert!.cohort_id ?? cohortFor(r.newCohort),
          owner_id: role === "donor_coordinator" ? userId : r.insert!.owner_id,
          source: "import",
        },
      }));
      const ins = await insertRows(supabase, "contacts", inserts.map((x) => x.record));
      for (const x of inserts) {
        if (ins.ok.has(x.record.id)) {
          createdIds.push(x.record.id);
          if (result.touched.length < 100) result.touched.push({ id: x.record.id, name: x.planRow.name, kind: "created" });
        } else {
          skipped.push({ ...lean(x.planRow), status: "error", reason: ins.failed.get(x.record.id) ?? SAVE_FAILED });
        }
      }

      // 3. existing people: fill only empty fields; the WHERE clause re-checks emptiness so nothing is ever overwritten
      const updates = plan.rows.filter((r) => r.status === "update" && r.contactId);
      await pool(updates, 8, async (r) => {
        const patch = { ...(r.patch ?? {}) } as Record<string, unknown>;
        if (r.newCohort && patch.cohort_id === undefined) {
          const id = cohortFor(r.newCohort);
          if (id) patch.cohort_id = id;
        }
        if (!Object.keys(patch).length) { result.unchanged++; matchedIds.push(r.contactId!); return; }
        let q = supabase.from("contacts").update(patch).eq("id", r.contactId!);
        for (const k of Object.keys(patch)) q = k === "last_name" ? q.eq("last_name", "") : q.is(k, null);
        const { data, error } = await q.select("id");
        if (error) { skipped.push({ ...lean(r), status: "error", reason: SAVE_FAILED }); return; }
        matchedIds.push(r.contactId!);
        if (data && data.length) {
          result.updated++;
          if (result.touched.length < 100) result.touched.push({ id: r.contactId!, name: r.name, kind: "updated" });
        } else result.unchanged++;
      });

      // 4. type tag
      if (options.typeCode && (createdIds.length || matchedIds.length)) {
        const ok = await tagContacts(supabase, [...createdIds, ...matchedIds], options.typeCode);
        if (!ok) result.partialError = "חלק מהתגיות לא נוספו (ייתכן שחסרה הרשאה לחלק מהרשומות).";
        result.listHref = `/contacts?type=${encodeURIComponent(options.typeCode)}`;
      }
      result.created = createdIds.length;
      for (const r of plan.rows) if (r.status === "error" || r.status === "duplicate") skipped.push(lean(r));
    } else {
      const plan = b.plan;
      const createDonors = fd.get("createDonors") === "yes";

      // 1. campaigns that do not exist yet
      const campaignIds = new Map(b.campaigns.map((c) => [normalizeLabel(c.name), c.id]));
      const toCreate = new Map<string, string>();
      for (const r of plan.rows) {
        if ((r.status === "new" || (r.status === "unmatched" && createDonors)) && r.campaignName && !campaignIds.has(normalizeLabel(r.campaignName))) {
          toCreate.set(normalizeLabel(r.campaignName), r.campaignName);
        }
      }
      if (toCreate.size) {
        const { data, error } = await supabase.from("campaigns").insert([...toCreate.values()].map((name) => ({ name }))).select("id,name");
        if (error) {
          // e.g. created meanwhile by someone else: read again
          const { data: again } = await supabase.from("campaigns").select("id,name");
          for (const c of again ?? []) campaignIds.set(normalizeLabel(c.name), c.id);
        }
        for (const c of data ?? []) { campaignIds.set(normalizeLabel(c.name), c.id); result.campaignsCreated.push(c.name); }
      }

      // 2. new donors (one per person, even when they have several rows)
      const donorIds = new Map<string, string>();
      if (createDonors) {
        const newDonors = new Map<string, { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }>();
        for (const r of plan.rows) {
          if (r.status !== "unmatched" || !r.donorKey || !r.data || newDonors.has(r.donorKey)) continue;
          newDonors.set(r.donorKey, { id: randomUUID(), first_name: r.data.first_name, last_name: r.data.last_name, phone: r.data.phone, email: r.data.email });
        }
        const records = [...newDonors.values()].map((d) => ({
          ...d, source: "import", owner_id: role === "donor_coordinator" ? userId : null,
          notes: `נוצר מייבוא תרומות (${upload.name})`.slice(0, 2000),
        }));
        const ins = await insertRows(supabase, "contacts", records);
        for (const [key, d] of newDonors) if (ins.ok.has(d.id)) donorIds.set(key, d.id);
        const created = [...donorIds.values()];
        if (created.length && !(await tagContacts(supabase, created, "donor"))) {
          result.partialError = "אנשי הקשר החדשים נוצרו, אבל תגית התורם לא נוספה לחלקם.";
        }
        result.donorsCreated = created.length;
        createdIds.push(...created);
        for (const [key, d] of newDonors) {
          if (donorIds.has(key) && result.touched.length < 100) result.touched.push({ id: d.id, name: `${d.first_name} ${d.last_name}`.trim(), kind: "created" });
        }
      }

      // 3. make sure matched donors carry the donor tag
      const matched = [...new Set(plan.rows.filter((r) => r.status === "new" && r.contactId).map((r) => r.contactId!))];
      if (matched.length && !(await tagContacts(supabase, matched, "donor"))) {
        result.partialError = "חלק מהתורמים הקיימים לא סומנו בתגית תורם.";
      }

      // 4. donations
      const toInsert: { planRow: PlanRow; record: Record<string, unknown> & { id: string } }[] = [];
      for (const r of plan.rows) {
        if (!r.data) continue;
        let contactId: string | null = null;
        if (r.status === "new") contactId = r.contactId ?? null;
        else if (r.status === "unmatched") {
          contactId = r.donorKey ? donorIds.get(r.donorKey) ?? null : null;
          if (!contactId) {
            skipped.push(createDonors ? { ...lean(r), status: "error", reason: `יצירת איש הקשר נכשלה — ${SAVE_FAILED}` } : { ...lean(r), reason: skippedReason(r, createDonors) });
            continue;
          }
        } else continue;
        if (!contactId) continue;
        toInsert.push({
          planRow: r,
          record: {
            id: randomUUID(),
            contact_id: contactId,
            amount: r.data.amount,
            currency: "ILS",
            donated_at: r.data.date,
            method: r.data.method || null,
            campaign_id: r.campaignName ? campaignIds.get(normalizeLabel(r.campaignName)) ?? null : null,
            is_recurring: r.data.recurring,
            external_ref: r.data.external_ref,
            notes: r.data.notes || null,
            import_batch_id: batchId,
            is_demo: false,
          },
        });
      }
      for (const part of chunks(toInsert, WRITE_CHUNK)) {
        const { data, error } = await supabase.from("donations")
          .upsert(part.map((x) => x.record), { onConflict: "external_ref", ignoreDuplicates: true }).select("id");
        if (!error) {
          const ok = new Set((data ?? []).map((d) => d.id as string));
          for (const x of part) {
            if (ok.has(x.record.id)) result.donationsCreated++;
            else skipped.push({ ...lean(x.planRow), status: "exists", reason: `תרומה עם אסמכתא ${x.planRow.ref ?? ""} כבר קיימת במערכת` });
          }
          continue;
        }
        for (const x of part) {
          const { error: e } = await supabase.from("donations").insert(x.record);
          if (e) skipped.push({ ...lean(x.planRow), status: "error", reason: SAVE_FAILED });
          else result.donationsCreated++;
        }
      }
      for (const r of plan.rows) if (r.status === "error" || r.status === "duplicate" || r.status === "exists") skipped.push(lean(r));
      result.listHref = "/contacts?type=donor";
      result.created = result.donorsCreated;
    }
  } catch {
    await supabase.from("import_batches").update({
      created_count: createdIds.length, updated_count: result.updated, skipped_count: skipped.length,
      report: { status: "failed", mode: b.mode, created_ids: createdIds, matched_ids: matchedIds },
    }).eq("id", batchId);
    revalidatePath("/contacts");
    return {
      ok: false,
      error: `הייבוא נעצר באמצע. ${createdIds.length.toLocaleString("he-IL")} רשומות כבר נשמרו (מופיעות ביומן הייבואים). ייבוא חוזר של אותו קובץ יזהה את מי שכבר נשמר לפי טלפון, דוא״ל או אסמכתא.`,
    };
  }

  skipped.sort((a, b2) => a.row - b2.row);
  result.skippedRows = skipped;
  result.skipped = skipped.length;

  const { error: finishError } = await supabase.from("import_batches").update({
    created_count: b.mode === "contacts" ? result.created : result.donationsCreated,
    updated_count: result.updated,
    skipped_count: result.skipped,
    report: {
      status: "done",
      mode: b.mode,
      fingerprint: upload.fingerprint,
      options: { ...options, createCohorts: fd.get("createCohorts") === "yes", createDonors: fd.get("createDonors") === "yes" },
      counts: {
        total: result.total, created: result.created, updated: result.updated, unchanged: result.unchanged,
        skipped: result.skipped, donations_created: result.donationsCreated, donors_created: result.donorsCreated,
      },
      cohorts_created: result.cohortsCreated,
      campaigns_created: result.campaignsCreated,
      created_ids: createdIds,
      matched_ids: matchedIds,
      skipped: skipped.map((r) => ({ row: r.row, status: r.status, name: r.name, reason: r.reason })),
      partial_error: result.partialError,
    },
  }).eq("id", batchId);
  if (finishError && !result.partialError) result.partialError = "הנתונים נשמרו, אבל סיכום הייבוא לא נשמר ביומן הייבואים.";

  revalidatePath("/contacts");
  revalidatePath("/contacts/import");
  revalidatePath("/contacts/quality");
  if (b.mode === "donations") revalidatePath("/donors");
  return result;
}

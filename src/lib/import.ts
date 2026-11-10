// Pure helpers for importing people and donations from Excel / CSV files.
// No database or framework code here: everything is unit-tested in import.test.ts
// and safe to use on both the server and the client.
import { normalizePhone } from "./phone";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
export const PREVIEW_ROWS = 200;

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
export type ImportMode = "contacts" | "donations";

export type ImportField =
  | "first_name" | "last_name" | "full_name" | "phone" | "email"
  | "cohort" | "region" | "city" | "profession" | "notes"
  | "amount" | "date" | "external_ref" | "campaign" | "method" | "recurring";

export const FIELD_LABELS: Record<ImportField, string> = {
  first_name: "שם פרטי",
  last_name: "שם משפחה",
  full_name: "שם מלא",
  phone: "טלפון",
  email: "דוא״ל",
  cohort: "מחזור גיוס",
  region: "אזור",
  city: "יישוב",
  profession: "מקצוע",
  notes: "הערות",
  amount: "סכום",
  date: "תאריך התרומה",
  external_ref: "אסמכתא / מספר קבלה",
  campaign: "קמפיין",
  method: "אמצעי תשלום",
  recurring: "הוראת קבע",
};

export const MODE_FIELDS: Record<ImportMode, ImportField[]> = {
  contacts: ["first_name", "last_name", "full_name", "phone", "email", "cohort", "region", "city", "profession", "notes"],
  donations: ["full_name", "first_name", "last_name", "phone", "email", "amount", "date", "external_ref", "campaign", "method", "recurring", "notes"],
};

/** Column index → field (null = not imported). */
export type Mapping = (ImportField | null)[];

// ---------------------------------------------------------------------------
// Text decoding and CSV parsing
// ---------------------------------------------------------------------------

/** Decode file bytes: UTF-8 (with or without BOM), UTF-16 (Excel "Unicode text"), else Windows-1255 (Hebrew Excel CSV). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    try {
      return new TextDecoder("windows-1255").decode(bytes);
    } catch {
      return stripBom(new TextDecoder("utf-8").decode(bytes));
    }
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Count delimiter occurrences per line, ignoring quoted text. */
function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch === d) n++;
  }
  return n;
}

/** Pick the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string): Delimiter {
  const lines = stripBom(text).split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").slice(0, 10);
  if (!lines.length) return ",";
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** RFC 4180 CSV parser: quoted fields, "" escapes, newlines inside quotes, CRLF/LF/CR, BOM. */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  const src = stripBom(text);
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === "") { inQuotes = true; field = ""; i++; continue; }
    if (ch === d) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // drop trailing empty lines
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

// ---------------------------------------------------------------------------
// Excel cell values (exceljs shapes) → text
// ---------------------------------------------------------------------------

/** Convert an exceljs cell value (string, number, Date, rich text, hyperlink, formula…) to plain text. */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    const time = iso.slice(11, 16);
    return time === "00:00" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("error" in v) return "";
    if ("result" in v) return cellToString(v.result);
    if ("formula" in v || "sharedFormula" in v) return "";
    if ("text" in v) return cellToString(v.text);
    if ("hyperlink" in v) return String(v.hyperlink ?? "");
  }
  return String(value);
}

/** The parts of an exceljs Worksheet we use (structural, so this file does not import exceljs). */
export interface SheetLike {
  rowCount: number;
  columnCount: number;
  getRow(r: number): { getCell(c: number): { value: unknown } };
}

/** Read a worksheet into a grid of trimmed strings; stops after `maxRows` non-empty rows. */
export function sheetToGrid(ws: SheetLike, maxRows = IMPORT_MAX_ROWS + 20, maxCols = 200): string[][] {
  const grid: string[][] = [];
  const width = Math.min(ws.columnCount, maxCols);
  let nonEmpty = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellToString(row.getCell(c).value).trim());
    grid.push(cells);
    if (cells.some((x) => x !== "")) nonEmpty++;
    if (nonEmpty > maxRows) break;
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Header detection and column mapping
// ---------------------------------------------------------------------------

/** Lower-case, drop quotes / geresh / punctuation, collapse spaces. */
export function normalizeHeader(h: string): string {
  return h
    .replace(/[‎‏‪-‮]/g, "")
    .toLowerCase()
    .replace(/["'`׳״*:.()[\]#]/g, "")
    .replace(/[_\-/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Rule = { field: ImportField; exact: string[]; contains: string[] };

// Order matters for "contains": more specific fields first, plain "שם" last.
const RULES: Rule[] = [
  { field: "first_name", exact: ["שם פרטי", "פרטי", "first name", "firstname", "first", "given name"], contains: ["שם פרטי", "first name", "firstname"] },
  { field: "last_name", exact: ["שם משפחה", "משפחה", "last name", "lastname", "surname", "family name"], contains: ["שם משפחה", "משפחה", "last name", "lastname", "surname"] },
  { field: "email", exact: ["דואל", "דוא ל", "דואר אלקטרוני", "מייל", "אימייל", "אי מייל", "email", "e mail", "mail"], contains: ["דואל", "דואר אלקטרוני", "מייל", "email", "e mail"] },
  { field: "phone", exact: ["טלפון", "נייד", "פלאפון", "פלפון", "סלולרי", "סלולארי", "טל", "phone", "mobile", "tel", "cell"], contains: ["טלפון", "נייד", "פלאפון", "פלפון", "סלולר", "סלולאר", "phone", "mobile"] },
  { field: "cohort", exact: ["מחזור", "מחזור גיוס", "גיוס", "cohort"], contains: ["מחזור", "cohort"] },
  { field: "region", exact: ["אזור", "איזור", "region", "area"], contains: ["אזור", "איזור", "region"] },
  { field: "city", exact: ["עיר", "יישוב", "ישוב", "מקום מגורים", "מגורים", "כתובת", "city", "town"], contains: ["עיר", "יישוב", "ישוב", "מגורים", "city"] },
  { field: "profession", exact: ["מקצוע", "עיסוק", "תפקיד", "profession", "occupation", "job"], contains: ["מקצוע", "עיסוק", "profession", "occupation"] },
  { field: "amount", exact: ["סכום", "סך", "amount", "sum", "total"], contains: ["סכום", "amount"] },
  { field: "date", exact: ["תאריך", "date"], contains: ["תאריך", "date"] },
  { field: "external_ref", exact: ["אסמכתא", "מספר קבלה", "קבלה", "מס קבלה", "reference", "ref", "receipt"], contains: ["אסמכתא", "קבלה", "reference", "receipt", "מזהה עסקה", "transaction"] },
  { field: "campaign", exact: ["קמפיין", "campaign"], contains: ["קמפיין", "campaign"] },
  { field: "method", exact: ["אמצעי תשלום", "אמצעי", "method", "payment method"], contains: ["אמצעי תשלום", "אמצעי", "payment method"] },
  { field: "recurring", exact: ["הוראת קבע", "הו״ק", "הוק", "קבוע", "recurring", "monthly"], contains: ["הוראת קבע", "recurring", "monthly"] },
  { field: "notes", exact: ["הערות", "הערה", "notes", "note", "comments", "comment"], contains: ["הערות", "הערה", "notes", "comment"] },
  { field: "full_name", exact: ["שם", "שם מלא", "שם התורם", "שם התורמת", "שם תורם", "name", "full name", "fullname"], contains: ["שם", "name"] },
];

const EXACT = new Map<string, ImportField>();
for (const r of RULES) for (const e of r.exact) EXACT.set(normalizeHeader(e), r.field);

function containsWord(h: string, kw: string): boolean {
  const k = normalizeHeader(kw);
  // Latin keywords must match whole words ("ref" must not match "preferred"); Hebrew ones may be a prefix-free substring.
  if (/^[a-z ]+$/.test(k)) return new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(h);
  return h.includes(k);
}

/** Best field for one header, limited to the fields of the mode (null = no guess). */
export function guessField(header: string, mode?: ImportMode): ImportField | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  const allowed = mode ? new Set(MODE_FIELDS[mode]) : null;
  const exact = EXACT.get(h);
  if (exact && (!allowed || allowed.has(exact))) return exact;
  for (const r of RULES) {
    if (allowed && !allowed.has(r.field)) continue;
    if (r.contains.some((kw) => containsWord(h, kw))) return r.field;
  }
  return null;
}

/** Guess a mapping; each field is used at most once (the first matching column wins). */
export function guessMapping(headers: string[], mode: ImportMode): Mapping {
  const used = new Set<ImportField>();
  // exact matches first, so "שם פרטי" is not taken by an earlier fuzzy "שם …" column
  const result: Mapping = headers.map(() => null);
  headers.forEach((h, i) => {
    const f = EXACT.get(normalizeHeader(h));
    if (f && MODE_FIELDS[mode].includes(f) && !used.has(f)) { result[i] = f; used.add(f); }
  });
  headers.forEach((h, i) => {
    if (result[i]) return;
    const f = guessField(h, mode);
    if (f && !used.has(f)) { result[i] = f; used.add(f); }
  });
  // A full-name column is redundant when first + last are both mapped.
  if (used.has("first_name") && used.has("last_name")) {
    const i = result.indexOf("full_name");
    if (i >= 0) result[i] = null;
  }
  return result;
}

/** Index of the header row: the row (among the first 15) with the most recognisable headers. */
export function detectHeaderRow(grid: string[][], scan = 15): number {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, scan); r++) {
    const cells = grid[r].map((c) => c.trim()).filter(Boolean);
    const known = cells.filter((c) => guessField(c) !== null && c.length <= 40).length;
    if (known > bestScore) { bestScore = known; best = r; }
  }
  if (best >= 0) return best;
  // no recognisable header: first row with at least two non-empty cells
  const r = grid.findIndex((row) => row.filter((c) => c.trim() !== "").length >= 2);
  return r >= 0 ? r : 0;
}

export interface RawRow {
  /** Line number in the original sheet (1-based), for messages like "שורה 12". */
  row: number;
  cells: string[];
}

export interface Table {
  headerRow: number;
  headers: string[];
  rows: RawRow[];
}

function columnLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Turn a sheet grid into header + data rows. Empty rows and empty trailing columns are dropped. */
export function extractTable(grid: string[][]): Table {
  if (!grid.length) return { headerRow: 0, headers: [], rows: [] };
  const h = detectHeaderRow(grid);
  const width = grid.slice(h).reduce((w, r) => {
    let last = -1;
    r.forEach((c, i) => { if (c.trim() !== "") last = i; });
    return Math.max(w, last + 1);
  }, 0);
  const headers = Array.from({ length: width }, (_, i) => {
    const v = (grid[h][i] ?? "").replace(/\s+/g, " ").trim();
    return v || `עמודה ${columnLetter(i)}`;
  });
  const rows: RawRow[] = [];
  for (let r = h + 1; r < grid.length; r++) {
    const cells = Array.from({ length: width }, (_, i) => (grid[r][i] ?? "").trim());
    if (cells.every((c) => c === "")) continue;
    rows.push({ row: r + 1, cells });
  }
  return { headerRow: h + 1, headers, rows };
}

/** Up to `n` distinct non-empty sample values per column. */
export function sampleValues(rows: RawRow[], columns: number, n = 3): string[][] {
  const out: string[][] = Array.from({ length: columns }, () => []);
  for (const r of rows) {
    let full = true;
    for (let i = 0; i < columns; i++) {
      const v = r.cells[i];
      if (out[i].length < n) {
        full = false;
        if (v && !out[i].includes(v)) out[i].push(v.length > 40 ? v.slice(0, 40) + "…" : v);
      }
    }
    if (full) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/** Collapse whitespace and strip invisible direction marks and wrapping quotes. */
export function cleanText(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .replace(/[‎‏‪-‮ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
}

/** "ישראל ישראלי" → {ישראל, ישראלי}; "כהן, משה" → {משה, כהן}; "בן ציון כהן" → {בן ציון, כהן}. */
export function splitFullName(full: string): { first: string; last: string } {
  const s = cleanText(full);
  if (!s) return { first: "", last: "" };
  if (s.includes(",")) {
    const [last, ...rest] = s.split(",");
    const first = rest.join(" ").trim();
    if (first && last.trim()) return { first, last: last.trim() };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  // compound first names: "בן ציון", "בת שבע", "בת אל" (only when a surname follows)
  if (parts.length >= 3 && (parts[0] === "בן" || parts[0] === "בת")) {
    return { first: `${parts[0]} ${parts[1]}`, last: parts.slice(2).join(" ") };
  }
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function normalizeEmail(v: string | null | undefined): string | null {
  const s = cleanText(v).replace(/^mailto:/i, "").toLowerCase();
  return EMAIL_RE.test(s) ? s : null;
}

/** Split a cell that may hold several values ("052-1234567 / 03-6123456", "a@x.com; b@y.com"). */
function splitMulti(v: string): string[] {
  return v.split(/\s*(?:[,;/|\n]|\sאו\s)\s*/).map((x) => x.trim()).filter(Boolean);
}

/** First valid phone in the cell + the rest (valid extras and invalid leftovers). */
export function pickPhone(raw: string): { phone: string | null; extra: string[]; invalid: string | null } {
  const s = cleanText(raw);
  if (!s) return { phone: null, extra: [], invalid: null };
  const whole = normalizePhone(s);
  if (whole && !/[,;/|]/.test(s)) return { phone: whole, extra: [], invalid: null };
  const parts = splitMulti(s);
  let phone: string | null = null;
  const extra: string[] = [];
  for (const p of parts) {
    const n = normalizePhone(p);
    if (n && !phone) phone = n;
    else if (n) extra.push(n);
  }
  if (!phone) return { phone: null, extra: [], invalid: s };
  return { phone, extra, invalid: null };
}

export function pickEmail(raw: string): { email: string | null; extra: string[]; invalid: string | null } {
  const s = cleanText(raw);
  if (!s) return { email: null, extra: [], invalid: null };
  const parts = splitMulti(s.replace(/\s+/g, " ")).flatMap((p) => p.split(" "));
  const valid = parts.map(normalizeEmail).filter((e): e is string => !!e);
  if (!valid.length) return { email: null, extra: [], invalid: s };
  return { email: valid[0], extra: valid.slice(1), invalid: null };
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Excel serial day number (1900 system) → YYYY-MM-DD. */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse a date as written in Israel (day first): 5/3/2024, 05.03.24, 2024-03-05, Excel serial 45356, Date objects.
 * Two-digit years: up to next year → 20xx, otherwise 19xx. Returns YYYY-MM-DD or null.
 */
export function parseDate(input: string | number | Date | null | undefined, now: Date = new Date()): string | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString().slice(0, 10);
  if (typeof input === "number") return excelSerialToISO(input);
  const s = cleanText(input);
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? ymd(y, mo, d) : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) {
      const pivot = (now.getUTCFullYear() % 100) + 1;
      y += y <= pivot ? 2000 : 1900;
    }
    return isValidYmd(y, mo, d) ? ymd(y, mo, d) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 10000 && n <= 80000) return excelSerialToISO(n);
  }
  return null;
}

/** "₪1,250.00" → 1250, "1.250,50" → 1250.5, "250 ש״ח" → 250. Returns null when unreadable. */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) / 100 : null;
  let s = cleanText(input)
    .replace(/ש\s*["״']?\s*ח/g, "")
    .replace(/₪|nis|ils|\$|€/gi, "")
    .replace(/\s+/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("");
    if (decimal === ",") s = s.replace(",", ".");
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    else return null;
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
    else if (!/^\d*\.\d+$/.test(s)) return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 100) / 100;
  return negative ? -r : r;
}

/** "כן" / "הוראת קבע" / "yes" / "1" → true; "לא" / "חד פעמי" / "0" → false; blank or unknown → null. */
export function parseBoolean(input: string | null | undefined): boolean | null {
  const s = normalizeHeader(cleanText(input));
  if (!s) return null;
  if (["כן", "yes", "y", "true", "1", "v", "✓", "✔", "x", "הוראת קבע", "הוק", "קבוע", "חודשי", "recurring", "monthly"].includes(s)) return true;
  if (["לא", "no", "n", "false", "0", "חד פעמי", "חד פעמית", "one time", "once", "single"].includes(s)) return false;
  return null;
}

/** Normalise a lookup label for comparison (cohort / region / campaign names). */
export function normalizeLabel(s: string | null | undefined): string {
  return cleanText(s)
    .toLowerCase()
    .replace(/["'`׳״]/g, "")
    .replace(/[-–—_/\\.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Find an id by label. Also matches when one side has the word "מחזור" and the other does not. */
export function matchLookup<T extends { id: number; label: string }>(label: string, list: T[]): number | null {
  const n = normalizeLabel(label);
  if (!n) return null;
  const strip = (x: string) => x.replace(/^מחזור\s+/, "");
  const exact = list.find((l) => normalizeLabel(l.label) === n);
  if (exact) return exact.id;
  const loose = list.find((l) => strip(normalizeLabel(l.label)) === strip(n));
  return loose ? loose.id : null;
}

// ---------------------------------------------------------------------------
// Row normalisation
// ---------------------------------------------------------------------------

function getter(raw: RawRow, mapping: Mapping) {
  return (f: ImportField): string => {
    const i = mapping.indexOf(f);
    return i >= 0 ? cleanText(raw.cells[i]) : "";
  };
}

function resolveName(get: (f: ImportField) => string): { first: string; last: string; full: string } {
  let first = get("first_name");
  let last = get("last_name");
  const full = get("full_name");
  if (!first && full) {
    const s = splitFullName(full);
    first = s.first;
    if (!last) last = s.last;
  } else if (first && !last && full && full !== first && full.startsWith(first + " ")) {
    last = full.slice(first.length + 1).trim();
  }
  return { first, last, full: [first, last].filter(Boolean).join(" ") };
}

function clip(v: string, max: number, label: string, warnings: string[]): string {
  if (v.length <= max) return v;
  warnings.push(`${label} קוצר ל-${max} תווים`);
  return v.slice(0, max);
}

export interface ContactRow {
  row: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  cohort: string;
  region: string;
  city: string;
  profession: string;
  /** Notes to store, including leftovers such as an unreadable phone number. */
  notes: string;
  errors: string[];
  warnings: string[];
}

export function normalizeContactRow(raw: RawRow, mapping: Mapping): ContactRow {
  const get = getter(raw, mapping);
  const warnings: string[] = [];
  const errors: string[] = [];
  const name = resolveName(get);
  const first = clip(name.first, 60, "השם הפרטי", warnings);
  const last = clip(name.last, 60, "שם המשפחה", warnings);
  if (!first) errors.push(name.last ? "חסר שם פרטי" : "חסר שם");

  const extraNotes: string[] = [];
  const p = pickPhone(get("phone"));
  if (p.invalid) { warnings.push(`טלפון לא תקין (${p.invalid}) — ייובא בלי טלפון`); extraNotes.push(`טלפון מהקובץ (לא תקין): ${p.invalid}`); }
  if (p.extra.length) extraNotes.push(`טלפון נוסף: ${p.extra.join(", ")}`);
  const e = pickEmail(get("email"));
  if (e.invalid) { warnings.push(`דוא״ל לא תקין (${e.invalid}) — ייובא בלי דוא״ל`); extraNotes.push(`דוא״ל מהקובץ (לא תקין): ${e.invalid}`); }
  if (e.extra.length) extraNotes.push(`דוא״ל נוסף: ${e.extra.join(", ")}`);
  if (!p.phone && !e.email && first) warnings.push("אין טלפון או דוא״ל — אי אפשר לבדוק אם האדם כבר קיים");

  const notes = clip([get("notes"), ...extraNotes].filter(Boolean).join("\n"), 2000, "ההערות", warnings);
  return {
    row: raw.row,
    first_name: first,
    last_name: last,
    phone: p.phone,
    email: e.email,
    cohort: get("cohort"),
    region: get("region"),
    city: clip(get("city"), 60, "שם היישוב", warnings),
    profession: clip(get("profession"), 80, "המקצוע", warnings),
    notes,
    errors,
    warnings,
  };
}

export interface DonationRow {
  row: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  amount: number | null;
  date: string | null;
  external_ref: string | null;
  campaign: string;
  method: string;
  recurring: boolean;
  notes: string;
  errors: string[];
  warnings: string[];
}

export function normalizeDonationRow(raw: RawRow, mapping: Mapping, now: Date = new Date()): DonationRow {
  const get = getter(raw, mapping);
  const warnings: string[] = [];
  const errors: string[] = [];
  const name = resolveName(get);
  const p = pickPhone(get("phone"));
  const e = pickEmail(get("email"));
  if (p.invalid) warnings.push(`טלפון לא תקין (${p.invalid}) — לא ישמש לזיהוי`);
  if (e.invalid) warnings.push(`דוא״ל לא תקין (${e.invalid}) — לא ישמש לזיהוי`);

  const amountRaw = get("amount");
  const amount = parseAmount(amountRaw);
  if (!amountRaw) errors.push("חסר סכום");
  else if (amount === null) errors.push(`הסכום לא מובן (${amountRaw})`);
  else if (amount <= 0) errors.push(`סכום לא חיובי (${amountRaw})`);

  const dateRaw = get("date");
  const date = parseDate(dateRaw, now);
  if (!dateRaw) errors.push("חסר תאריך");
  else if (!date) errors.push(`התאריך לא מובן (${dateRaw})`);
  else if (date > now.toISOString().slice(0, 10)) warnings.push("תאריך עתידי");

  if (!p.phone && !e.email && !name.first) errors.push("אין טלפון, דוא״ל או שם לזיהוי התורם/ת");

  const recurringRaw = get("recurring");
  const recurring = parseBoolean(recurringRaw);
  if (recurringRaw && recurring === null) warnings.push(`לא ברור אם הוראת קבע (${recurringRaw}) — נרשם כחד־פעמי`);

  const ref = get("external_ref");
  return {
    row: raw.row,
    first_name: name.first.slice(0, 60),
    last_name: name.last.slice(0, 60),
    phone: p.phone,
    email: e.email,
    amount: amount !== null && amount > 0 ? amount : null,
    date,
    external_ref: ref ? ref.slice(0, 100) : null,
    campaign: get("campaign").slice(0, 120),
    method: get("method").slice(0, 40),
    recurring: recurring ?? false,
    notes: get("notes").slice(0, 2000),
    errors,
    warnings,
  };
}

/**
 * Duplicates inside the file: for each row, the index of the earlier row it repeats
 * (same phone or same e-mail), or null. Rows marked `skip` (e.g. errors) are ignored.
 */
export function findInFileDuplicates(rows: { phone: string | null; email: string | null; skip?: boolean }[]): (number | null)[] {
  const byPhone = new Map<string, number>();
  const byEmail = new Map<string, number>();
  return rows.map((r, i) => {
    if (r.skip) return null;
    const hit = (r.phone ? byPhone.get(r.phone) : undefined) ?? (r.email ? byEmail.get(r.email) : undefined);
    const original = hit ?? i;
    if (r.phone && !byPhone.has(r.phone)) byPhone.set(r.phone, original);
    if (r.email && !byEmail.has(r.email)) byEmail.set(r.email, original);
    return hit ?? null;
  });
}

/** Generic "same key as an earlier row" check (null keys are never duplicates). */
export function findDuplicateKeys(keys: (string | null)[]): (number | null)[] {
  const seen = new Map<string, number>();
  return keys.map((k, i) => {
    if (!k) return null;
    const hit = seen.get(k);
    if (hit !== undefined) return hit;
    seen.set(k, i);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Planning: what will happen to each row (pure, so it can be tested)
// ---------------------------------------------------------------------------

export type RowStatus = "new" | "update" | "error" | "duplicate" | "exists" | "unmatched";

export const STATUS_LABELS: Record<ImportMode, Record<RowStatus, string>> = {
  contacts: {
    new: "חדש",
    update: "קיים — יעודכנו רק שדות ריקים",
    error: "שגיאה",
    duplicate: "כפול בתוך הקובץ",
    exists: "קיים",
    unmatched: "לא נמצא",
  },
  donations: {
    new: "תרומה חדשה",
    update: "תרומה חדשה",
    error: "שגיאה",
    duplicate: "כפול בתוך הקובץ",
    exists: "כבר יובאה",
    unmatched: "לא נמצא איש קשר",
  },
};

/** One row as shown in the preview / result report. */
export interface PlanRow {
  row: number;
  status: RowStatus;
  name: string;
  phone: string | null;
  email: string | null;
  reason: string;
  warnings: string[];
  amount?: number | null;
  date?: string | null;
  ref?: string | null;
  contactId?: string | null;
}

export interface LookupItem { id: number; label: string }

export interface ExistingContact {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  cohort_id: number | null;
  region_id: number | null;
  city: string | null;
  profession: string | null;
  notes: string | null;
  owner_id: string | null;
  archived_at?: string | null;
}

export type ContactPatch = Partial<Pick<ExistingContact, "last_name" | "phone" | "email" | "cohort_id" | "region_id" | "city" | "profession" | "notes" | "owner_id">>;

export interface ContactInsert {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  cohort_id: number | null;
  region_id: number | null;
  city: string | null;
  profession: string | null;
  notes: string | null;
  owner_id: string | null;
}

export interface PlannedContact extends PlanRow {
  insert?: ContactInsert;
  /** For matched rows: the fields that are empty in the record and will be filled. */
  patch?: ContactPatch;
  /** Cohort label from the file that does not exist yet (may be created by an admin). */
  newCohort?: string;
}

export interface ContactPlanOptions {
  cohorts: LookupItem[];
  regions: LookupItem[];
  defaultCohortId: number | null;
  defaultRegionId: number | null;
  defaultOwnerId: string | null;
  sourceNote: string;
}

export interface ContactPlan {
  rows: PlannedContact[];
  unknownCohorts: { label: string; rows: number }[];
  unknownRegions: { label: string; rows: number }[];
}

const PATCH_LABELS: Record<keyof ContactPatch, string> = {
  last_name: "שם משפחה", phone: "טלפון", email: "דוא״ל", cohort_id: "מחזור", region_id: "אזור",
  city: "יישוב", profession: "מקצוע", notes: "הערות", owner_id: "אחראי/ת",
};

function tally(map: Map<string, { label: string; rows: number }>, label: string) {
  const k = normalizeLabel(label).replace(/^מחזור\s+/, "");
  const cur = map.get(k);
  if (cur) cur.rows++;
  else map.set(k, { label, rows: 1 });
}

/**
 * Decide, for every row, whether it creates a new person, fills empty fields of an existing one
 * (matched by phone, then e-mail), is an error, or repeats an earlier row. Never overwrites a value.
 */
export function planContacts(rows: ContactRow[], existing: ExistingContact[], opts: ContactPlanOptions): ContactPlan {
  const byPhone = new Map<string, ExistingContact>();
  const byEmail = new Map<string, ExistingContact>();
  for (const c of existing) {
    if (c.phone && !byPhone.has(c.phone)) byPhone.set(c.phone, c);
    if (c.email && !byEmail.has(c.email)) byEmail.set(c.email, c);
  }
  const dups = findInFileDuplicates(rows.map((r) => ({ phone: r.phone, email: r.email, skip: r.errors.length > 0 })));
  const matchedBy = new Map<string, number>(); // existing id → file row that already updates it
  const unknownCohorts = new Map<string, { label: string; rows: number }>();
  const unknownRegions = new Map<string, { label: string; rows: number }>();

  const planned = rows.map((r, i): PlannedContact => {
    const base: PlanRow = {
      row: r.row, status: "new", name: [r.first_name, r.last_name].filter(Boolean).join(" "),
      phone: r.phone, email: r.email, reason: "", warnings: [...r.warnings],
    };
    if (r.errors.length) return { ...base, status: "error", reason: r.errors.join("; ") };
    if (dups[i] !== null) {
      const o = rows[dups[i]!];
      const same = r.phone && r.phone === o.phone ? "אותו טלפון" : "אותו דוא״ל";
      return { ...base, status: "duplicate", reason: `${same} כמו בשורה ${o.row} — השורה לא תיובא` };
    }

    let cohortId: number | null = null;
    let newCohort: string | undefined;
    if (r.cohort) {
      cohortId = matchLookup(r.cohort, opts.cohorts);
      if (cohortId === null) { newCohort = r.cohort; tally(unknownCohorts, r.cohort); base.warnings.push(`המחזור "${r.cohort}" לא קיים ברשימת המחזורים`); }
    } else cohortId = opts.defaultCohortId;
    let regionId: number | null = null;
    if (r.region) {
      regionId = matchLookup(r.region, opts.regions);
      if (regionId === null) { tally(unknownRegions, r.region); base.warnings.push(`האזור "${r.region}" לא קיים ברשימת האזורים — יישאר ריק`); }
    } else regionId = opts.defaultRegionId;

    const match = (r.phone && byPhone.get(r.phone)) || (r.email && byEmail.get(r.email)) || null;
    if (!match) {
      const notes = [r.notes, opts.sourceNote ? `מקור הייבוא: ${opts.sourceNote}` : ""].filter(Boolean).join("\n").slice(0, 2000);
      return {
        ...base,
        status: "new",
        reason: "ייווצר אדם חדש",
        newCohort,
        insert: {
          first_name: r.first_name, last_name: r.last_name, phone: r.phone, email: r.email,
          cohort_id: cohortId, region_id: regionId, city: r.city || null, profession: r.profession || null,
          notes: notes || null, owner_id: opts.defaultOwnerId,
        },
      };
    }

    const earlier = matchedBy.get(match.id);
    if (earlier !== undefined) {
      return { ...base, status: "duplicate", contactId: match.id, reason: `מתאים לאותה רשומה קיימת כמו שורה ${earlier} — השורה לא תיובא` };
    }
    matchedBy.set(match.id, r.row);

    const patch: ContactPatch = {};
    const kept: string[] = [];
    const fill = <K extends keyof ContactPatch>(k: K, value: ContactPatch[K] | null | undefined, current: unknown, empty: boolean) => {
      if (value === null || value === undefined || value === "") return;
      if (empty) patch[k] = value;
      else if (current !== value) kept.push(PATCH_LABELS[k]);
    };
    fill("last_name", r.last_name, match.last_name, match.last_name === "");
    if (r.phone) {
      const other = byPhone.get(r.phone);
      if (other && other.id !== match.id) base.warnings.push("הטלפון שייך לרשומה אחרת — לא יועתק");
      else fill("phone", r.phone, match.phone, match.phone === null);
    }
    if (r.email) {
      const other = byEmail.get(r.email);
      if (other && other.id !== match.id) base.warnings.push("הדוא״ל שייך לרשומה אחרת — לא יועתק");
      else fill("email", r.email, match.email, match.email === null);
    }
    fill("cohort_id", cohortId, match.cohort_id, match.cohort_id === null);
    fill("region_id", regionId, match.region_id, match.region_id === null);
    fill("city", r.city, match.city, match.city === null);
    fill("profession", r.profession, match.profession, match.profession === null);
    fill("notes", r.notes, match.notes, match.notes === null);
    fill("owner_id", opts.defaultOwnerId, match.owner_id, match.owner_id === null);
    const filled = Object.keys(patch).map((k) => PATCH_LABELS[k as keyof ContactPatch]);
    // A different owner is not a "conflict" worth reporting: the default owner only fills empty places.
    const conflicts = kept.filter((k) => k !== PATCH_LABELS.owner_id && k !== PATCH_LABELS.notes);
    const how = r.phone && byPhone.get(r.phone)?.id === match.id ? "לפי טלפון" : "לפי דוא״ל";
    const parts = [
      `נמצא ${how}: ${[match.first_name, match.last_name].filter(Boolean).join(" ")}`,
      filled.length ? `יושלמו: ${filled.join(", ")}` : "אין שדות ריקים להשלים",
    ];
    if (conflicts.length) parts.push(`ערך אחר בקובץ ל${conflicts.join(", ")} — נשאר הערך הקיים`);
    if (match.archived_at) parts.push("הרשומה בארכיון");
    return {
      ...base, status: "update", contactId: match.id, reason: parts.join(". "),
      patch: Object.keys(patch).length ? patch : undefined,
      newCohort: match.cohort_id === null ? newCohort : undefined,
    };
  });

  return {
    rows: planned,
    unknownCohorts: [...unknownCohorts.values()],
    unknownRegions: [...unknownRegions.values()],
  };
}

export interface PlannedDonation extends PlanRow {
  data?: DonationRow;
  /** Key grouping rows of the same unmatched donor, so one contact is created per person. */
  donorKey?: string;
  campaignName?: string;
}

export interface DonationPlan {
  rows: PlannedDonation[];
  newCampaigns: { label: string; rows: number }[];
  unmatchedDonors: number;
}

export interface ExistingDonation {
  contact_id: string;
  donated_at: string;
  amount: number;
  external_ref: string | null;
}

/** Key identifying an unmatched donor inside the file: phone, else e-mail, else the name. */
export function donorKey(r: { phone: string | null; email: string | null; first_name: string; last_name: string }): string {
  if (r.phone) return `p:${r.phone}`;
  if (r.email) return `e:${r.email}`;
  return `n:${normalizeLabel(`${r.first_name} ${r.last_name}`)}`;
}

export function planDonations(
  rows: DonationRow[],
  existing: ExistingContact[],
  existingDonations: ExistingDonation[],
  campaigns: { id: number; name: string }[],
): DonationPlan {
  const byPhone = new Map<string, ExistingContact>();
  const byEmail = new Map<string, ExistingContact>();
  for (const c of existing) {
    if (c.phone && !byPhone.has(c.phone)) byPhone.set(c.phone, c);
    if (c.email && !byEmail.has(c.email)) byEmail.set(c.email, c);
  }
  const refs = new Set(existingDonations.map((d) => d.external_ref).filter(Boolean) as string[]);
  const sameDay = new Set(existingDonations.map((d) => `${d.contact_id}|${d.donated_at}|${Number(d.amount).toFixed(2)}`));
  const refDups = findDuplicateKeys(rows.map((r) => (r.errors.length ? null : r.external_ref)));
  const contentDups = findDuplicateKeys(rows.map((r) =>
    r.errors.length || r.external_ref ? null : `${donorKey(r)}|${r.date}|${r.amount?.toFixed(2)}`));
  const campaignNames = new Map(campaigns.map((c) => [normalizeLabel(c.name), c.name]));
  const newCampaigns = new Map<string, { label: string; rows: number }>();
  const unmatchedKeys = new Set<string>();

  const planned = rows.map((r, i): PlannedDonation => {
    const base: PlannedDonation = {
      row: r.row, status: "new", name: [r.first_name, r.last_name].filter(Boolean).join(" "),
      phone: r.phone, email: r.email, reason: "", warnings: [...r.warnings],
      amount: r.amount, date: r.date, ref: r.external_ref,
    };
    if (r.errors.length) return { ...base, status: "error", reason: r.errors.join("; ") };
    if (refDups[i] !== null) return { ...base, status: "duplicate", reason: `אותה אסמכתא כמו בשורה ${rows[refDups[i]!].row}` };
    if (contentDups[i] !== null) return { ...base, status: "duplicate", reason: `אותו תורם, תאריך וסכום כמו בשורה ${rows[contentDups[i]!].row}, בלי אסמכתא` };
    if (r.external_ref && refs.has(r.external_ref)) return { ...base, status: "exists", reason: `תרומה עם אסמכתא ${r.external_ref} כבר קיימת במערכת` };

    let campaignName: string | undefined;
    if (r.campaign) {
      const known = campaignNames.get(normalizeLabel(r.campaign));
      campaignName = known ?? r.campaign;
      if (!known) tally(newCampaigns, r.campaign);
    }
    if (!r.external_ref) base.warnings.push("אין אסמכתא — ייבוא חוזר של אותו קובץ עלול לכפול את התרומה");

    const match = (r.phone && byPhone.get(r.phone)) || (r.email && byEmail.get(r.email)) || null;
    if (match) {
      if (!r.external_ref && sameDay.has(`${match.id}|${r.date}|${r.amount!.toFixed(2)}`)) {
        return { ...base, status: "exists", contactId: match.id, reason: "כבר קיימת תרומה של אותו אדם באותו תאריך ובאותו סכום" };
      }
      const who = [match.first_name, match.last_name].filter(Boolean).join(" ");
      return { ...base, status: "new", contactId: match.id, data: r, campaignName, reason: `תשויך ל${who}${r.phone && byPhone.get(r.phone)?.id === match.id ? " (לפי טלפון)" : " (לפי דוא״ל)"}` };
    }
    if (!r.first_name) {
      return { ...base, status: "error", reason: "לא נמצא איש קשר תואם, ואין שם כדי ליצור איש קשר חדש" };
    }
    const key = donorKey(r);
    unmatchedKeys.add(key);
    return { ...base, status: "unmatched", data: r, donorKey: key, campaignName, reason: "לא נמצא איש קשר עם אותו טלפון או דוא״ל" };
  });

  return { rows: planned, newCampaigns: [...newCampaigns.values()], unmatchedDonors: unmatchedKeys.size };
}

export function countStatuses(rows: { status: RowStatus }[]): Record<RowStatus, number> {
  const c: Record<RowStatus, number> = { new: 0, update: 0, error: 0, duplicate: 0, exists: 0, unmatched: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

// ---------------------------------------------------------------------------
// CSV output (skipped-rows report)
// ---------------------------------------------------------------------------

/** Neutralise spreadsheet formulas (=, +, -, @) in text cells; plain numbers and phone numbers are left as they are. */
export function csvSafe(v: string): string {
  if (/^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s().,-]+$/.test(v)) return `'${v}`;
  return v;
}

/** Build CSV text with a BOM so Excel opens Hebrew correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = csvSafe(v === null || v === undefined ? "" : String(v));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

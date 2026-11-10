import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  cellToString, cleanText, csvSafe, decodeText, detectDelimiter, detectHeaderRow, donorKey, excelSerialToISO, extractTable,
  findDuplicateKeys, findInFileDuplicates, guessField, guessMapping, matchLookup, normalizeContactRow, normalizeDonationRow,
  normalizeEmail, normalizeHeader, parseAmount, parseBoolean, parseCsv, parseDate, pickEmail, pickPhone, planContacts,
  planDonations, sampleValues, sheetToGrid, splitFullName, toCsv, countStatuses,
  type ExistingContact, type Mapping, type RawRow,
} from "./import";

const NOW = new Date("2026-11-02T10:00:00Z");

describe("decodeText", () => {
  it("strips a UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("שם,טלפון")]);
    expect(decodeText(bytes)).toBe("שם,טלפון");
  });
  it("falls back to Windows-1255 for Hebrew Excel CSV", () => {
    // "שלום" in Windows-1255: ש=0xF9 ל=0xEC ו=0xE5 ם=0xED
    expect(decodeText(new Uint8Array([0xf9, 0xec, 0xe5, 0xed]))).toBe("שלום");
  });
  it("reads UTF-16LE with BOM (Excel 'Unicode text')", () => {
    const s = "א\tב";
    const buf = new Uint8Array(2 + s.length * 2);
    buf[0] = 0xff; buf[1] = 0xfe;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); buf[2 + i * 2] = c & 0xff; buf[3 + i * 2] = c >> 8; }
    expect(decodeText(buf)).toBe("א\tב");
  });
});

describe("parseCsv", () => {
  it("parses commas, quotes, escaped quotes and newlines inside quotes", () => {
    const csv = 'שם,הערות\r\n"כהן, משה","אמר ""שלום""\nושורה שנייה"\r\nדנה,\r\n';
    expect(parseCsv(csv)).toEqual([
      ["שם", "הערות"],
      ["כהן, משה", 'אמר "שלום"\nושורה שנייה'],
      ["דנה", ""],
    ]);
  });
  it("detects semicolons and tabs", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
    expect(parseCsv("שם;טלפון\nדנה;052-1234567")).toEqual([["שם", "טלפון"], ["דנה", "052-1234567"]]);
    expect(parseCsv("שם\tטלפון\nדנה\t052")).toEqual([["שם", "טלפון"], ["דנה", "052"]]);
  });
  it("prefers the delimiter that is consistent across lines", () => {
    // commas appear inside a free-text column, semicolons are the real separator
    expect(detectDelimiter("שם;הערות;טלפון\nדנה;אחת, שתיים;052\nרון;שלוש;053")).toBe(";");
  });
  it("handles a BOM, CR-only line endings and a missing final newline", () => {
    expect(parseCsv("﻿א,ב\r1,2\r3,4")).toEqual([["א", "ב"], ["1", "2"], ["3", "4"]]);
  });
  it("drops trailing empty lines but keeps empty fields", () => {
    expect(parseCsv("a,b\n1,\n\n\n")).toEqual([["a", "b"], ["1", ""]]);
  });
});

describe("cellToString", () => {
  it("handles exceljs value shapes", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString("טקסט")).toBe("טקסט");
    expect(cellToString(521234567)).toBe("521234567");
    expect(cellToString(1250.5)).toBe("1250.5");
    expect(cellToString(true)).toBe("true");
    expect(cellToString(new Date(Date.UTC(2024, 2, 5)))).toBe("2024-03-05");
    expect(cellToString(new Date(Date.UTC(2024, 2, 5, 14, 30)))).toBe("2024-03-05 14:30");
    expect(cellToString({ richText: [{ text: "משה " }, { text: "כהן" }] })).toBe("משה כהן");
    expect(cellToString({ text: "dana@example.com", hyperlink: "mailto:dana@example.com" })).toBe("dana@example.com");
    expect(cellToString({ formula: "A1*2", result: 84 })).toBe("84");
    expect(cellToString({ formula: "A1*2" })).toBe("");
    expect(cellToString({ error: "#N/A" })).toBe("");
    expect(cellToString({ formula: "A1", result: new Date(Date.UTC(2023, 0, 1)) })).toBe("2023-01-01");
  });
});

describe("header guessing", () => {
  it("normalises headers", () => {
    expect(normalizeHeader(' דוא"ל ')).toBe("דואל");
    expect(normalizeHeader("דוא״ל")).toBe("דואל");
    expect(normalizeHeader("מס' טלפון:")).toBe("מס טלפון");
    expect(normalizeHeader("First_Name")).toBe("first name");
  });
  it("recognises Hebrew and English headers", () => {
    const cases: [string, string | null][] = [
      ["שם פרטי", "first_name"], ["שם משפחה", "last_name"], ["שם מלא", "full_name"], ["שם", "full_name"],
      ["טלפון", "phone"], ["נייד", "phone"], ["פלאפון", "phone"], ["סלולרי", "phone"], ["מספר טלפון", "phone"], ["טלפון נייד", "phone"],
      ['דוא"ל', "email"], ["מייל", "email"], ["אימייל", "email"], ["Email", "email"], ["דואר אלקטרוני", "email"],
      ["מחזור", "cohort"], ["מחזור גיוס", "cohort"], ["אזור", "region"], ["אזור מגורים", "region"],
      ["עיר", "city"], ["יישוב", "city"], ["מקום מגורים", "city"], ["הערות", "notes"], ["מקצוע", "profession"],
      ["סכום", "amount"], ["סכום התרומה", "amount"], ["תאריך", "date"], ["תאריך תרומה", "date"],
      ["אסמכתא", "external_ref"], ["מספר קבלה", "external_ref"], ["מס' אסמכתא", "external_ref"],
      ["קמפיין", "campaign"], ["שם הקמפיין", "campaign"], ["אמצעי תשלום", "method"], ["הוראת קבע", "recurring"],
      ["First Name", "first_name"], ["Last name", "last_name"], ["Phone", "phone"], ["Preferred time", null], ["", null], ["xyz", null],
    ];
    for (const [h, f] of cases) expect([h, guessField(h)]).toEqual([h, f]);
  });
  it("limits guesses to the fields of the mode", () => {
    expect(guessField("סכום", "contacts")).toBeNull();
    expect(guessField("מחזור", "donations")).toBeNull();
    expect(guessField("תאריך לידה", "contacts")).toBeNull();
  });
  it("maps each field once and prefers exact matches", () => {
    const m = guessMapping(["שם התורם", "שם פרטי", "טלפון", "טלפון נוסף", "סכום"], "contacts");
    // "שם התורם" is a full name; "שם פרטי" is an exact first-name match; second phone stays unmapped
    expect(m).toEqual(["full_name", "first_name", "phone", null, null]);
  });
  it("drops the full-name column when first and last are mapped", () => {
    expect(guessMapping(["שם מלא", "שם פרטי", "שם משפחה"], "contacts")).toEqual([null, "first_name", "last_name"]);
  });
  it("guesses a donations file", () => {
    expect(guessMapping(["שם התורם", "נייד", "מייל", "סכום", "תאריך", "מספר קבלה", "קמפיין", "אמצעי תשלום", "הוראת קבע"], "donations"))
      .toEqual(["full_name", "phone", "email", "amount", "date", "external_ref", "campaign", "method", "recurring"]);
  });
});

describe("table extraction", () => {
  it("finds the header row below a title and skips empty rows", () => {
    const grid = [
      ["רשימת חברים — מחזור 2005", "", ""],
      ["", "", ""],
      ["שם פרטי", "שם משפחה", "טלפון"],
      ["משה", "כהן", "052-1234567"],
      ["", "", ""],
      ["דנה", "לוי", ""],
    ];
    expect(detectHeaderRow(grid)).toBe(2);
    const t = extractTable(grid);
    expect(t.headerRow).toBe(3);
    expect(t.headers).toEqual(["שם פרטי", "שם משפחה", "טלפון"]);
    expect(t.rows).toEqual([
      { row: 4, cells: ["משה", "כהן", "052-1234567"] },
      { row: 6, cells: ["דנה", "לוי", ""] },
    ]);
  });
  it("names blank headers and drops empty trailing columns", () => {
    const t = extractTable([["שם", "", "טלפון", "", ""], ["רון", "x", "050", "", ""]]);
    expect(t.headers).toEqual(["שם", "עמודה B", "טלפון"]);
    expect(t.rows[0].cells).toEqual(["רון", "x", "050"]);
  });
  it("collects sample values", () => {
    const rows: RawRow[] = [
      { row: 2, cells: ["a", "1"] }, { row: 3, cells: ["a", "2"] }, { row: 4, cells: ["b", ""] }, { row: 5, cells: ["c", "3"] },
    ];
    expect(sampleValues(rows, 2, 2)).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("returns an empty table for an empty grid", () => {
    expect(extractTable([])).toEqual({ headerRow: 0, headers: [], rows: [] });
  });
});

describe("names", () => {
  it("splits full names", () => {
    expect(splitFullName("ישראל ישראלי")).toEqual({ first: "ישראל", last: "ישראלי" });
    expect(splitFullName("  יוסי   בן   דוד ")).toEqual({ first: "יוסי", last: "בן דוד" });
    expect(splitFullName("בן ציון כהן")).toEqual({ first: "בן ציון", last: "כהן" });
    expect(splitFullName("בן כהן")).toEqual({ first: "בן", last: "כהן" });
    expect(splitFullName("כהן, משה")).toEqual({ first: "משה", last: "כהן" });
    expect(splitFullName("מדונה")).toEqual({ first: "מדונה", last: "" });
    expect(splitFullName("")).toEqual({ first: "", last: "" });
  });
  it("cleans invisible characters and wrapping quotes", () => {
    expect(cleanText("‏ משה  כהן ")).toBe("משה כהן");
    expect(cleanText('"דנה"')).toBe("דנה");
  });
});

describe("phones and e-mails", () => {
  it("picks the first valid phone and keeps the rest", () => {
    expect(pickPhone("052-1234567")).toEqual({ phone: "+972521234567", extra: [], invalid: null });
    expect(pickPhone("521234567")).toEqual({ phone: "+972521234567", extra: [], invalid: null }); // Excel dropped the 0
    expect(pickPhone("052-1234567 / 03-6123456")).toEqual({ phone: "+972521234567", extra: ["+97236123456"], invalid: null });
    expect(pickPhone("052-1234567 או 054-7654321").phone).toBe("+972521234567");
    expect(pickPhone("12345")).toEqual({ phone: null, extra: [], invalid: "12345" });
    expect(pickPhone("")).toEqual({ phone: null, extra: [], invalid: null });
  });
  it("lower-cases and validates e-mails", () => {
    expect(normalizeEmail(" Dana@Example.COM ")).toBe("dana@example.com");
    expect(normalizeEmail("mailto:x@y.co.il")).toBe("x@y.co.il");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(pickEmail("a@x.com; B@y.com")).toEqual({ email: "a@x.com", extra: ["b@y.com"], invalid: null });
    expect(pickEmail("dana at gmail")).toEqual({ email: null, extra: [], invalid: "dana at gmail" });
  });
});

describe("parseDate", () => {
  it("reads day-first Israeli dates", () => {
    expect(parseDate("05/03/2024", NOW)).toBe("2024-03-05");
    expect(parseDate("5/3/2024", NOW)).toBe("2024-03-05");
    expect(parseDate("5.3.24", NOW)).toBe("2024-03-05");
    expect(parseDate("31-12-1999", NOW)).toBe("1999-12-31");
    expect(parseDate("05/03/2024 10:22", NOW)).toBe("2024-03-05");
  });
  it("reads ISO dates", () => {
    expect(parseDate("2024-03-05", NOW)).toBe("2024-03-05");
    expect(parseDate("2024-03-05T10:00:00Z", NOW)).toBe("2024-03-05");
    expect(parseDate("2024/3/5", NOW)).toBe("2024-03-05");
  });
  it("uses a pivot for two-digit years", () => {
    expect(parseDate("1.1.27", NOW)).toBe("2027-01-01");
    expect(parseDate("1.1.28", NOW)).toBe("1928-01-01");
    expect(parseDate("1.1.85", NOW)).toBe("1985-01-01");
  });
  it("reads Excel serial numbers and Date objects", () => {
    expect(excelSerialToISO(45000)).toBe("2023-03-15");
    expect(excelSerialToISO(1)).toBe("1899-12-31");
    expect(parseDate(45000, NOW)).toBe("2023-03-15");
    expect(parseDate("45000", NOW)).toBe("2023-03-15");
    expect(parseDate(new Date(Date.UTC(2024, 0, 2)), NOW)).toBe("2024-01-02");
  });
  it("rejects impossible or unreadable dates", () => {
    expect(parseDate("31/02/2024", NOW)).toBeNull();
    expect(parseDate("13/13/2024", NOW)).toBeNull();
    expect(parseDate("אתמול", NOW)).toBeNull();
    expect(parseDate("2024", NOW)).toBeNull();
    expect(parseDate("", NOW)).toBeNull();
    expect(parseDate(null, NOW)).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads shekel amounts in common formats", () => {
    expect(parseAmount("₪1,250.00")).toBe(1250);
    expect(parseAmount("1,250")).toBe(1250);
    expect(parseAmount("1250")).toBe(1250);
    expect(parseAmount("180.5")).toBe(180.5);
    expect(parseAmount("250 ש״ח")).toBe(250);
    expect(parseAmount('250 ש"ח')).toBe(250);
    expect(parseAmount("NIS 36")).toBe(36);
    expect(parseAmount("1.250,50")).toBe(1250.5);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("1,000,000")).toBe(1000000);
    expect(parseAmount(" ₪ 1 000 ")).toBe(1000);
    expect(parseAmount(99.999)).toBe(100);
  });
  it("keeps the sign so callers can reject refunds", () => {
    expect(parseAmount("-100")).toBe(-100);
    expect(parseAmount("(100)")).toBe(-100);
  });
  it("returns null for text", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("מאה")).toBeNull();
    expect(parseAmount("1,2,3")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("parseBoolean", () => {
  it("understands Hebrew and English", () => {
    expect(parseBoolean("כן")).toBe(true);
    expect(parseBoolean("הוראת קבע")).toBe(true);
    expect(parseBoolean("הו\"ק")).toBe(true);
    expect(parseBoolean("Yes")).toBe(true);
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("לא")).toBe(false);
    expect(parseBoolean("חד פעמי")).toBe(false);
    expect(parseBoolean("חד-פעמי")).toBe(false);
    expect(parseBoolean("")).toBeNull();
    expect(parseBoolean("אולי")).toBeNull();
  });
});

describe("matchLookup", () => {
  const cohorts = [{ id: 1, label: "מחזור נובמבר 2005" }, { id: 2, label: "אוג׳ 2010" }, { id: 3, label: "2012" }];
  it("matches ignoring spaces, quotes and the word מחזור", () => {
    expect(matchLookup("  מחזור   נובמבר 2005 ", cohorts)).toBe(1);
    expect(matchLookup("נובמבר 2005", cohorts)).toBe(1);
    expect(matchLookup("אוג' 2010", cohorts)).toBe(2);
    expect(matchLookup("מחזור 2012", cohorts)).toBe(3);
    expect(matchLookup("2013", cohorts)).toBeNull();
    expect(matchLookup("", cohorts)).toBeNull();
  });
});

describe("normalizeContactRow", () => {
  const mapping: Mapping = ["full_name", "phone", "email", "cohort", "region", "city", "notes"];
  it("splits the name and normalises phone and e-mail", () => {
    const r = normalizeContactRow({ row: 2, cells: ["משה כהן", "052-123-4567", "Moshe@Gmail.com ", "2005", "מרכז", "רעננה", ""] }, mapping);
    expect(r).toMatchObject({
      row: 2, first_name: "משה", last_name: "כהן", phone: "+972521234567", email: "moshe@gmail.com",
      cohort: "2005", region: "מרכז", city: "רעננה", notes: "", errors: [],
    });
  });
  it("keeps an invalid phone as a warning and in the notes", () => {
    const r = normalizeContactRow({ row: 3, cells: ["דנה לוי", "123", "", "", "", "", "חברה ותיקה"] }, mapping);
    expect(r.phone).toBeNull();
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("טלפון לא תקין");
    expect(r.notes).toBe("חברה ותיקה\nטלפון מהקובץ (לא תקין): 123");
  });
  it("reports a missing name as an error", () => {
    expect(normalizeContactRow({ row: 4, cells: ["", "0521234567", "", "", "", "", ""] }, mapping).errors).toEqual(["חסר שם"]);
    const m2: Mapping = ["first_name", "last_name"];
    expect(normalizeContactRow({ row: 5, cells: ["", "כהן"] }, m2).errors).toEqual(["חסר שם פרטי"]);
  });
  it("prefers explicit first/last columns over the full name", () => {
    const m: Mapping = ["first_name", "last_name", "full_name"];
    expect(normalizeContactRow({ row: 2, cells: ["דנה", "", "דנה בר לב"] }, m)).toMatchObject({ first_name: "דנה", last_name: "בר לב" });
    expect(normalizeContactRow({ row: 2, cells: ["", "", "רון שחר"] }, m)).toMatchObject({ first_name: "רון", last_name: "שחר" });
  });
  it("keeps extra phones and e-mails in the notes", () => {
    const r = normalizeContactRow({ row: 2, cells: ["רון", "050-1111111, 03-6123456", "a@x.com; b@x.com", "", "", "", ""] }, mapping);
    expect(r.phone).toBe("+972501111111");
    expect(r.email).toBe("a@x.com");
    expect(r.notes).toContain("טלפון נוסף: +97236123456");
    expect(r.notes).toContain("דוא״ל נוסף: b@x.com");
  });
  it("warns when there is no way to match", () => {
    const r = normalizeContactRow({ row: 2, cells: ["רון", "", "", "", "", "", ""] }, mapping);
    expect(r.warnings.join(" ")).toContain("אי אפשר לבדוק");
  });
});

describe("normalizeDonationRow", () => {
  const mapping: Mapping = ["full_name", "phone", "email", "amount", "date", "external_ref", "campaign", "method", "recurring"];
  it("parses a full donation row", () => {
    const r = normalizeDonationRow({ row: 2, cells: ["משה כהן", "0521234567", "", "₪1,250.00", "05/03/2024", "R-100", "ראש השנה", "אשראי", "כן"] }, mapping, NOW);
    expect(r).toMatchObject({
      first_name: "משה", last_name: "כהן", phone: "+972521234567", amount: 1250, date: "2024-03-05",
      external_ref: "R-100", campaign: "ראש השנה", method: "אשראי", recurring: true, errors: [],
    });
  });
  it("reports missing or bad amount and date", () => {
    const r = normalizeDonationRow({ row: 3, cells: ["משה", "", "", "מאה", "31/02/2024", "", "", "", ""] }, mapping, NOW);
    expect(r.errors).toEqual(["הסכום לא מובן (מאה)", "התאריך לא מובן (31/02/2024)"]);
    const r2 = normalizeDonationRow({ row: 4, cells: ["משה", "", "", "-50", "", "", "", "", ""] }, mapping, NOW);
    expect(r2.errors).toEqual(["סכום לא חיובי (-50)", "חסר תאריך"]);
    expect(r2.amount).toBeNull();
  });
  it("needs some identity", () => {
    const r = normalizeDonationRow({ row: 5, cells: ["", "", "", "100", "1.1.2025", "", "", "", ""] }, mapping, NOW);
    expect(r.errors).toEqual(["אין טלפון, דוא״ל או שם לזיהוי התורם/ת"]);
  });
  it("warns about future dates and unclear recurring values", () => {
    const r = normalizeDonationRow({ row: 6, cells: ["דנה", "", "", "100", "1.1.2030", "", "", "", "אולי"] }, mapping, NOW);
    expect(r.warnings).toEqual(["תאריך עתידי", "לא ברור אם הוראת קבע (אולי) — נרשם כחד־פעמי"]);
    expect(r.recurring).toBe(false);
  });
});

describe("duplicates inside the file", () => {
  it("finds repeats by phone or e-mail and points to the first row", () => {
    expect(findInFileDuplicates([
      { phone: "+972501", email: null },
      { phone: null, email: "a@x.com" },
      { phone: "+972501", email: "b@x.com" }, // same phone as 0
      { phone: null, email: "b@x.com" },      // same e-mail as 2, which repeats 0
      { phone: "+972502", email: "a@x.com" }, // same e-mail as 1
      { phone: null, email: null },
      { phone: null, email: null },
    ])).toEqual([null, null, 0, 0, 1, null, null]);
  });
  it("ignores skipped (error) rows", () => {
    expect(findInFileDuplicates([
      { phone: "+972501", email: null, skip: true },
      { phone: "+972501", email: null },
    ])).toEqual([null, null]);
  });
  it("finds repeated keys", () => {
    expect(findDuplicateKeys(["a", null, "b", "a", null])).toEqual([null, null, null, 0, null]);
  });
});

const existing = (over: Partial<ExistingContact>): ExistingContact => ({
  id: "c1", first_name: "משה", last_name: "כהן", phone: null, email: null, cohort_id: null, region_id: null,
  city: null, profession: null, notes: null, owner_id: null, ...over,
});

describe("planContacts", () => {
  const mapping: Mapping = ["full_name", "phone", "email", "cohort", "region", "city"];
  const row = (n: number, cells: string[]) => normalizeContactRow({ row: n, cells }, mapping);
  const opts = {
    cohorts: [{ id: 7, label: "מחזור 2005" }], regions: [{ id: 3, label: "מרכז" }],
    defaultCohortId: null, defaultRegionId: null, defaultOwnerId: null, sourceNote: "",
  };

  it("creates new people and fills only empty fields of existing ones", () => {
    const rows = [
      row(2, ["משה כהן", "052-1234567", "moshe@x.com", "2005", "מרכז", "רעננה"]),
      row(3, ["דנה לוי", "054-7654321", "", "", "", "חיפה"]),
    ];
    const plan = planContacts(rows, [existing({ id: "c1", phone: "+972521234567", city: "תל אביב", cohort_id: null })], opts);
    const [a, b] = plan.rows;
    expect(a.status).toBe("update");
    expect(a.contactId).toBe("c1");
    expect(a.patch).toEqual({ email: "moshe@x.com", cohort_id: 7, region_id: 3 });
    expect(a.reason).toContain("נמצא לפי טלפון");
    expect(a.reason).toContain("ערך אחר בקובץ ליישוב — נשאר הערך הקיים");
    expect(b.status).toBe("new");
    expect(b.insert).toMatchObject({ first_name: "דנה", last_name: "לוי", phone: "+972547654321", city: "חיפה", cohort_id: null });
  });

  it("matches by e-mail when the phone is unknown", () => {
    const plan = planContacts([row(2, ["משה כהן", "050-0000000", "moshe@x.com", "", "", ""])],
      [existing({ id: "c9", email: "moshe@x.com", phone: "+972521111111" })], opts);
    expect(plan.rows[0].status).toBe("update");
    expect(plan.rows[0].contactId).toBe("c9");
    expect(plan.rows[0].patch).toBeUndefined(); // phone differs → not overwritten
    expect(plan.rows[0].reason).toContain("נמצא לפי דוא״ל");
    expect(plan.rows[0].reason).toContain("ערך אחר בקובץ לטלפון");
  });

  it("never copies a phone that belongs to another record", () => {
    const plan = planContacts([row(2, ["משה כהן", "052-1234567", "moshe@x.com", "", "", ""])], [
      existing({ id: "c1", email: "moshe@x.com" }),
      existing({ id: "c2", phone: "+972521234567", email: "other@x.com" }),
    ], opts);
    // matched by phone first → c2; the e-mail belongs to c1 and must not be copied to c2
    expect(plan.rows[0].contactId).toBe("c2");
    expect(plan.rows[0].patch).toBeUndefined();
    expect(plan.rows[0].warnings).toContain("הדוא״ל שייך לרשומה אחרת — לא יועתק");
  });

  it("reports errors, in-file duplicates and two rows hitting the same record", () => {
    const rows = [
      row(2, ["", "052-1234567", "", "", "", ""]),
      row(3, ["רון", "052-1234567", "", "", "", ""]),
      row(4, ["רון שני", "052-1234567", "", "", "", ""]),
      row(5, ["משה", "", "moshe@x.com", "", "", ""]),
      row(6, ["משה כהן", "053-3333333", "", "", "", ""]),
    ];
    const plan = planContacts(rows, [existing({ id: "c1", email: "moshe@x.com", phone: "+972533333333" })], opts);
    expect(plan.rows.map((r) => r.status)).toEqual(["error", "new", "duplicate", "update", "duplicate"]);
    expect(plan.rows[2].reason).toContain("שורה 3");
    expect(plan.rows[4].reason).toContain("אותה רשומה קיימת כמו שורה 5");
    expect(countStatuses(plan.rows)).toMatchObject({ new: 1, update: 1, error: 1, duplicate: 2 });
  });

  it("reports unknown cohorts and regions and applies defaults only to empty cells", () => {
    const rows = [
      row(2, ["א ב", "", "", "מחזור 1999", "גליל", ""]),
      row(3, ["ג ד", "", "", "1999", "", ""]),
      row(4, ["ה ו", "", "", "", "", ""]),
    ];
    const plan = planContacts(rows, [], { ...opts, defaultCohortId: 7, defaultRegionId: 3, defaultOwnerId: "s1", sourceNote: "וואטסאפ" });
    expect(plan.unknownCohorts).toEqual([{ label: "מחזור 1999", rows: 2 }]);
    expect(plan.unknownRegions).toEqual([{ label: "גליל", rows: 1 }]);
    expect(plan.rows[0].insert).toMatchObject({ cohort_id: null, region_id: null, owner_id: "s1" });
    expect(plan.rows[0].newCohort).toBe("מחזור 1999");
    expect(plan.rows[2].insert).toMatchObject({ cohort_id: 7, region_id: 3, notes: "מקור הייבוא: וואטסאפ" });
  });

  it("fills an empty owner of an existing record with the default owner", () => {
    const plan = planContacts([row(2, ["משה כהן", "052-1234567", "", "", "", ""])],
      [existing({ phone: "+972521234567" })], { ...opts, defaultOwnerId: "s1" });
    expect(plan.rows[0].patch).toEqual({ owner_id: "s1" });
    const plan2 = planContacts([row(2, ["משה כהן", "052-1234567", "", "", "", ""])],
      [existing({ phone: "+972521234567", owner_id: "s2" })], { ...opts, defaultOwnerId: "s1" });
    expect(plan2.rows[0].patch).toBeUndefined();
    expect(plan2.rows[0].reason).toContain("אין שדות ריקים להשלים");
  });
});

describe("planDonations", () => {
  const mapping: Mapping = ["full_name", "phone", "email", "amount", "date", "external_ref", "campaign"];
  const row = (n: number, cells: string[]) => normalizeDonationRow({ row: n, cells }, mapping, NOW);
  const contacts = [existing({ id: "c1", phone: "+972521234567" }), existing({ id: "c2", first_name: "דנה", last_name: "לוי", email: "dana@x.com" })];

  it("matches donors, skips already imported refs, flags unmatched donors and new campaigns", () => {
    const rows = [
      row(2, ["משה כהן", "052-1234567", "", "100", "1.1.2025", "R1", "חנוכה"]),
      row(3, ["דנה", "", "dana@x.com", "200", "2.1.2025", "R2", "קמפיין חדש"]),
      row(4, ["משה כהן", "052-1234567", "", "100", "1.1.2025", "R0", ""]),
      row(5, ["רון שחר", "050-9999999", "", "50", "3.1.2025", "R3", ""]),
      row(6, ["רון שחר", "050-9999999", "", "60", "4.1.2025", "R4", ""]),
      row(7, ["", "050-8888888", "", "70", "4.1.2025", "R5", ""]),
      row(8, ["משה כהן", "052-1234567", "", "100", "1.1.2025", "R1", ""]),
      row(9, ["משה כהן", "", "", "abc", "1.1.2025", "R6", ""]),
    ];
    const plan = planDonations(rows, contacts, [{ contact_id: "c1", donated_at: "2024-01-01", amount: 5, external_ref: "R0" }], [{ id: 1, name: "חנוכה" }]);
    expect(plan.rows.map((r) => r.status)).toEqual(["new", "new", "exists", "unmatched", "unmatched", "error", "duplicate", "error"]);
    expect(plan.rows[0].contactId).toBe("c1");
    expect(plan.rows[0].campaignName).toBe("חנוכה");
    expect(plan.rows[1].contactId).toBe("c2");
    expect(plan.rows[1].reason).toContain("לפי דוא״ל");
    expect(plan.rows[3].donorKey).toBe(plan.rows[4].donorKey);
    expect(plan.unmatchedDonors).toBe(1);
    expect(plan.newCampaigns).toEqual([{ label: "קמפיין חדש", rows: 1 }]);
    expect(plan.rows[6].reason).toContain("שורה 2");
  });

  it("detects a donation without a reference that already exists for the same donor, date and amount", () => {
    const plan = planDonations([row(2, ["משה", "052-1234567", "", "100", "1.1.2025", "", ""])], contacts,
      [{ contact_id: "c1", donated_at: "2025-01-01", amount: 100, external_ref: null }], []);
    expect(plan.rows[0].status).toBe("exists");
  });

  it("flags identical rows without a reference inside the file", () => {
    const plan = planDonations([
      row(2, ["משה", "052-1234567", "", "100", "1.1.2025", "", ""]),
      row(3, ["משה", "052-1234567", "", "100", "1.1.2025", "", ""]),
    ], contacts, [], []);
    expect(plan.rows.map((r) => r.status)).toEqual(["new", "duplicate"]);
    expect(plan.rows[0].warnings.join(" ")).toContain("אין אסמכתא");
  });

  it("builds donor keys from phone, e-mail or name", () => {
    expect(donorKey({ phone: "+9725", email: "a@x.com", first_name: "a", last_name: "b" })).toBe("p:+9725");
    expect(donorKey({ phone: null, email: "a@x.com", first_name: "a", last_name: "b" })).toBe("e:a@x.com");
    expect(donorKey({ phone: null, email: null, first_name: "רון", last_name: "שחר" })).toBe("n:רון שחר");
  });
});

describe("CSV output", () => {
  it("adds a BOM, quotes when needed and neutralises formulas", () => {
    expect(toCsv([["שורה", "סיבה"], [2, 'אמר "כן", ואז'], [3, "=HYPERLINK(\"x\")"], [4, null]]))
      .toBe('﻿שורה,סיבה\r\n2,"אמר ""כן"", ואז"\r\n3,"\'=HYPERLINK(""x"")"\r\n4,');
  });
  it("leaves phone numbers and negative numbers alone", () => {
    expect(csvSafe("+972521234567")).toBe("+972521234567");
    expect(csvSafe("-100")).toBe("-100");
    expect(csvSafe("@cmd")).toBe("'@cmd");
    expect(csvSafe("+SUM(A1)")).toBe("'+SUM(A1)");
  });
  it("round-trips through the parser", () => {
    const rows = [["שם", "הערות"], ["משה, כהן", 'שורה "א"\nשורה ב']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("reading a real xlsx (exceljs round trip)", () => {
  it("reads rich text, hyperlinks, dates, numbers and formulas, below a title row", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("רשימה");
    ws.addRow(["רשימת מחזור 2005"]);
    ws.addRow([]);
    ws.addRow(["שם מלא", "נייד", "מייל", "תאריך", "סכום"]);
    ws.addRow([
      { richText: [{ text: "משה " }, { font: { bold: true }, text: "כהן" }] },
      521234567,
      { text: "Moshe@Example.com", hyperlink: "mailto:Moshe@Example.com" },
      new Date(Date.UTC(2024, 2, 5)),
      { formula: "1000+250", result: 1250 },
    ]);
    ws.addRow(["דנה לוי", "054-7654321", "", "05/03/2024", "₪180"]);
    const buf = await wb.xlsx.writeBuffer();

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as unknown as Parameters<typeof back.xlsx.load>[0]);
    const table = extractTable(sheetToGrid(back.worksheets[0]));
    expect(table.headerRow).toBe(3);
    expect(table.headers).toEqual(["שם מלא", "נייד", "מייל", "תאריך", "סכום"]);
    expect(table.rows.map((r) => r.cells)).toEqual([
      ["משה כהן", "521234567", "Moshe@Example.com", "2024-03-05", "1250"],
      ["דנה לוי", "054-7654321", "", "05/03/2024", "₪180"],
    ]);

    const mapping = guessMapping(table.headers, "donations");
    expect(mapping).toEqual(["full_name", "phone", "email", "date", "amount"]);
    const rows = table.rows.map((r) => normalizeDonationRow(r, mapping, NOW));
    expect(rows.map((r) => [r.first_name, r.last_name, r.phone, r.email, r.date, r.amount])).toEqual([
      ["משה", "כהן", "+972521234567", "moshe@example.com", "2024-03-05", 1250],
      ["דנה", "לוי", "+972547654321", null, "2024-03-05", 180],
    ]);
  });

  it("stops reading after the row limit", () => {
    const sheet = {
      rowCount: 100, columnCount: 1,
      getRow: (r: number) => ({ getCell: () => ({ value: `שורה ${r}` }) }),
    };
    expect(sheetToGrid(sheet, 10).length).toBe(11);
  });
});

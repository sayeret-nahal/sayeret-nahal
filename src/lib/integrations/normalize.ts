// Turns each provider's payload into the normalized event the database functions expect.
// Field names follow the providers' public documentation (see docs/09-integrations.md):
//   JGive  — Donation Webhook Event: transfer / donation / donor / donation_target objects
//   Grow   — account webhooks (JSON) and notifyUrl callbacks (form-encoded, data[...] wrapper)
//   Nexus  — no public API: rows of the club's periodic report (Excel/CSV) or a generic JSON push
// Unknown/extra fields are kept in `raw` so nothing is lost and mappings can be corrected later.

export type PaymentEvent = {
  external_id: string;
  kind: "payment" | "refund";
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  amount?: number;
  currency?: string;
  paid_at?: string; // YYYY-MM-DD
  recurring?: boolean;
  campaign?: string;
  marketing_consent?: boolean | null;
  raw: unknown;
};

export type BenefitEvent = {
  external_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  used_at?: string;
  description?: string;
  amount?: number;
  raw: unknown;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t ? t : undefined;
};
const n = (v: unknown): number | undefined => {
  const t = s(v)?.replace(/[,₪\s]/g, "");
  const x = t ? Number(t) : NaN;
  return Number.isFinite(x) ? x : undefined;
};
const b = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  const t = s(v)?.toLowerCase();
  if (!t) return undefined;
  if (["1", "true", "yes", "on", "כן", "v"].includes(t)) return true;
  if (["0", "false", "no", "off", "לא"].includes(t)) return false;
  return undefined;
};

/** Dates arrive as ISO, "DD/MM/YY", "DD/MM/YYYY" or "DD.MM.YYYY [HH:MM]" — returns YYYY-MM-DD (Israel time) or undefined. */
export function toDate(v: unknown): string | undefined {
  const t = s(v);
  if (!t) return undefined;
  const dmy = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/);
  if (dmy) {
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const d = new Date(Date.UTC(y, Number(dmy[2]) - 1, Number(dmy[1])));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

/** Reads JSON, or form-encoded bodies including PHP-style keys like data[fullName] / data[customFields][cField1]. */
export async function readBody(req: Request): Promise<Obj> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (!text) return {};
  if (type.includes("json") || /^\s*[{[]/.test(text)) {
    try {
      return obj(JSON.parse(text));
    } catch {
      return {};
    }
  }
  const out: Obj = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const path = key.replace(/\]/g, "").split("[");
    let cur: Obj = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) cur[p] = value;
      else cur = (cur[p] = obj(cur[p])) as Obj;
    });
  }
  return out;
}

// ------------------------------------------------------------------ JGive

export function fromJGive(body: Obj): PaymentEvent | null {
  const transfer = obj(body.transfer);
  const donation = obj(body.donation);
  const donor = obj(body.donor);
  const target = obj(body.donation_target);
  const id = s(transfer.id) ?? s(donation.donation_id) ?? s(body.id);
  if (!id) return null;
  const refunded = s(transfer.refunded_at);
  return {
    external_id: id,
    kind: refunded ? "refund" : "payment",
    full_name: s(donor.full_name),
    first_name: s(donor.first_name),
    last_name: s(donor.last_name),
    phone: s(donor.phone_number) ?? s(donor.phone),
    email: s(donor.email),
    amount: n(transfer.amount) ?? n(donation.amount),
    currency: s(transfer.currency) ?? s(donation.amount_currency) ?? "ILS",
    paid_at: toDate(transfer.completed_at) ?? toDate(donation.created_at),
    recurring: b(donation.recurring) ?? false,
    campaign: s(target.name_he) ?? s(donation.purpose_he) ?? s(target.name),
    marketing_consent: b(donor.newsletter) ?? b(donor.marketing_consent) ?? null,
    raw: body,
  };
}

// ------------------------------------------------------------------ Grow (Meshulam)

const GROW_RECURRING = new Set(["1"]); // paymentType 1 = direct debit (הוראת קבע)

export function fromGrow(input: Obj): PaymentEvent | null {
  // notifyUrl callbacks wrap everything in data[...]; account webhooks are flat (some keys snake_case)
  const body = Object.keys(obj(input.data)).length ? { ...input, ...obj(input.data) } : input;
  const id = s(body.transactionCode) ?? s(body.transactionId) ?? s(body.transaction_id) ?? s(body.asmachta);
  if (!id) return null;
  const custom = { ...obj(body.customFields), ...obj(body.purchaseCustomField) };
  const dynamic = Array.isArray(body.dynamicFields) ? (body.dynamicFields as Obj[]) : [];
  const consentField = dynamic.find((f) => /דיוור|עדכונ|newsletter|consent|הסכמ/i.test(String(f.label ?? f.key ?? "")));
  // "failed recurring payment" webhooks carry error_message / charges_attempts — not a payment
  if (s(body.error_message) || s(body.charges_attempts)) return null;
  return {
    external_id: id,
    kind: /refund|זיכוי|החזר/i.test(s(body.type) ?? s(body.transactionType) ?? "") ? "refund" : "payment",
    full_name: s(body.fullName) ?? s(body.payer_name) ?? s(body.payerName),
    phone: s(body.payerPhone) ?? s(body.phone),
    email: s(body.payerEmail) ?? s(body.email),
    amount: n(body.paymentSum) ?? n(body.sum),
    currency: s(body.currency) ?? "ILS",
    paid_at: toDate(body.paymentDate) ?? toDate(body.date),
    recurring: GROW_RECURRING.has(s(body.paymentType) ?? "") || !!s(body.directDebitId),
    campaign: s(body.purchasePageTitle) ?? s(body.description) ?? s(body.paymentDesc) ?? s(custom.cField1),
    marketing_consent: consentField ? b(consentField.field_value ?? consentField.value) ?? null : null,
    raw: input,
  };
}

// ------------------------------------------------------------------ Nexus (consumer club)

/** A JSON push or one report row. Accepts Hebrew or English column names. */
export function fromNexus(row: Obj): BenefitEvent | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(row).find((x) => x.trim().toLowerCase() === k.toLowerCase());
      if (hit && s(row[hit])) return s(row[hit]);
    }
    return undefined;
  };
  const phone = pick("phone", "mobile", "טלפון", "נייד", "טלפון נייד");
  const email = pick("email", "mail", "דוא״ל", "דוא\"ל", "אימייל", "מייל");
  const date = toDate(pick("date", "purchase_date", "order_date", "תאריך", "תאריך רכישה", "תאריך הזמנה"));
  const order = pick("order_id", "orderid", "order", "id", "transaction_id", "מספר הזמנה", "מס' הזמנה", "מזהה", "אסמכתא");
  if (!phone && !email) return null;
  return {
    external_id: order ?? `${phone ?? email}:${date ?? ""}:${pick("amount", "סכום") ?? ""}`,
    full_name: pick("full_name", "name", "שם מלא", "שם"),
    first_name: pick("first_name", "שם פרטי"),
    last_name: pick("last_name", "שם משפחה"),
    phone,
    email,
    used_at: date,
    description: pick("product", "description", "item", "מוצר", "תיאור", "שם מוצר", "ספק"),
    amount: n(pick("amount", "total", "sum", "סכום", "סה״כ", "סה\"כ", "מחיר")),
    raw: row,
  };
}

// ------------------------------------------------------------------ payment reports (Excel/CSV export)

/**
 * One row of a payments export (JGive "Donations → Download", or a Grow transactions report).
 * Column names are matched loosely (Hebrew or English), since exports change column order and wording.
 */
export function fromPaymentRow(provider: "jgive" | "grow", row: Obj): PaymentEvent | null {
  const keys = Object.keys(row);
  const norm = (k: string) => k.toLowerCase().replace(/["'״׳]/g, "").replace(/[\s_-]+/g, " ").trim();
  const pick = (...want: string[]) => {
    for (const w of want) {
      const hit = keys.find((k) => norm(k) === norm(w));
      if (hit && s(row[hit])) return s(row[hit]);
    }
    return undefined;
  };
  const id = pick("id", "transaction id", "transactioncode", "transaction code", "מספר עסקה", "מזהה עסקה", "אסמכתא", "מספר אסמכתא", "provider payment id", "donation id");
  const phone = pick("donor phone number", "phone", "payer phone", "טלפון", "נייד", "טלפון נייד");
  const email = pick("donor email", "email", "payer email", "דואל", "דוא ל", "אימייל", "מייל");
  if (!id || (!phone && !email)) return null;
  const refunded = pick("refunded at", "is negative", "chargeback", "זיכוי", "הוחזר");
  return {
    external_id: id,
    kind: refunded && !/^(false|0|no|לא)$/i.test(refunded) ? "refund" : "payment",
    first_name: pick("donor first name", "first name", "שם פרטי"),
    last_name: pick("donor last name", "last name", "שם משפחה"),
    full_name: pick("full name", "name", "payer name", "שם מלא", "שם הלקוח", "שם המשלם", "שם"),
    phone,
    email,
    amount: n(pick("amount", "sum", "payment sum", "סכום", "סכום עסקה", "סה״כ", "סהכ")),
    currency: pick("currency", "מטבע") ?? "ILS",
    paid_at: toDate(pick("transaction date", "date", "payment date", "תאריך", "תאריך עסקה", "תאריך תשלום")),
    recurring: b(pick("recurring", "הוראת קבע", "תשלום חודשי")) ?? /קבע|direct/i.test(pick("payment type", "סוג תשלום", "סוג עסקה") ?? ""),
    campaign: pick("target name", "campaign", "page", "קמפיין", "דף תשלום", "תיאור"),
    marketing_consent: null,
    raw: { provider, source: "report", row },
  };
}

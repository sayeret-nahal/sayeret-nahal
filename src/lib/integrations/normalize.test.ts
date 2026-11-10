import { describe, expect, it } from "vitest";
import { fromGrow, fromJGive, fromNexus, fromPaymentRow, readBody, toDate } from "./normalize";

describe("toDate", () => {
  it("reads the formats providers send", () => {
    expect(toDate("21/12/21")).toBe("2021-12-21");
    expect(toDate("05.03.2026 14:20")).toBe("2026-03-05");
    expect(toDate("2026-10-01T22:30:00Z")).toBe("2026-10-02"); // Israel time
    expect(toDate("garbage")).toBeUndefined();
  });
});

describe("JGive webhook", () => {
  it("maps donor, transfer and recurring fields", () => {
    const ev = fromJGive({
      transfer: { id: 991, amount: "180.0", currency: "ILS", completed_at: "2026-10-01T09:00:00+03:00" },
      donation: { donation_id: 55, recurring: true, purpose_he: "דמי חבר" },
      donor: { first_name: "דנה", last_name: "לוי", phone_number: "054-7654321", email: "d@x.org" },
      donation_target: { name_he: "חברות בעמותה" },
    })!;
    expect(ev).toMatchObject({ external_id: "991", kind: "payment", first_name: "דנה", phone: "054-7654321", amount: 180, recurring: true, campaign: "חברות בעמותה", paid_at: "2026-10-01" });
  });
  it("treats refunded transfers as refunds", () => {
    expect(fromJGive({ transfer: { id: 991, refunded_at: "2026-10-05" } })!.kind).toBe("refund");
  });
});

describe("Grow", () => {
  it("parses a form-encoded notifyUrl callback with data[...] keys", async () => {
    const req = new Request("https://x/api/hooks/grow", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "data%5BtransactionId%5D=777&data%5BfullName%5D=%D7%A8%D7%95%D7%9F&data%5BpayerPhone%5D=0521234567&data%5Bsum%5D=50&data%5BpaymentType%5D=1&data%5BpaymentDate%5D=21%2F12%2F25",
    });
    const ev = fromGrow(await readBody(req))!;
    expect(ev).toMatchObject({ external_id: "777", full_name: "רון", phone: "0521234567", amount: 50, recurring: true, paid_at: "2025-12-21" });
  });
  it("maps an account webhook and ignores failed recurring charges", () => {
    expect(fromGrow({ transactionCode: "A1", paymentSum: "100", payerEmail: "a@b.co", purchasePageTitle: "דמי חבר" })!).toMatchObject({ external_id: "A1", amount: 100, campaign: "דמי חבר", recurring: false });
    expect(fromGrow({ regular_payment_id: "9", transactionCode: "X", error_message: "declined", charges_attempts: "2" })).toBeNull();
  });
});

describe("reports", () => {
  it("reads a JGive export row", () => {
    const ev = fromPaymentRow("jgive", { id: "123", "Transaction Date": "01/10/2026", Amount: "180", "Donor First Name": "דנה", "Donor Last Name": "לוי", "Donor Phone Number": "0547654321", Recurring: "true", "Target Name": "חברות", "Refunded At": "" })!;
    expect(ev).toMatchObject({ external_id: "123", kind: "payment", amount: 180, recurring: true, paid_at: "2026-10-01" });
  });
  it("reads a Nexus report with Hebrew headers", () => {
    const ev = fromNexus({ "מספר הזמנה": "N-5", "שם מלא": "יוסי כהן", "טלפון נייד": "050-1112233", "תאריך רכישה": "05/10/2026", "מוצר": "מקרר", "סכום": "3,200" })!;
    expect(ev).toMatchObject({ external_id: "N-5", full_name: "יוסי כהן", used_at: "2026-10-05", description: "מקרר", amount: 3200 });
  });
  it("skips rows without a way to identify the person", () => {
    expect(fromNexus({ "מספר הזמנה": "N-6", "מוצר": "x" })).toBeNull();
    expect(fromPaymentRow("grow", { id: "1", Amount: "5" })).toBeNull();
  });
});

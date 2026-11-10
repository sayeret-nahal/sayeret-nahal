import { describe, expect, it } from "vitest";
import { displayPhone, normalizePhone } from "./phone";
import { addDays, memorialDates } from "./dates";

describe("phone", () => {
  it("normalises Israeli formats like the database does", () => {
    expect(normalizePhone("052-123 4567")).toBe("+972521234567");
    expect(normalizePhone("+972 52 1234567")).toBe("+972521234567");
    expect(normalizePhone("00972521234567")).toBe("+972521234567");
    expect(normalizePhone("04-8123456")).toBe("+97248123456");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+1 212 555 0100")).toBe("+12125550100");
  });
  it("displays local format", () => {
    expect(displayPhone("+972521234567")).toBe("052-123-4567");
    expect(displayPhone("+97248123456")).toBe("04-812-3456");
  });
});

describe("memorial dates", () => {
  it("finds the next azkara by the Hebrew calendar", () => {
    // 20 Jul 2014 = 22 Tammuz 5774. 22 Tammuz 5787 = 27 Jul 2027.
    const m = memorialDates("2014-07-20", false, "2026-11-02");
    expect(m.nextAzkara).toBe("2027-07-27");
    expect(m.azkaraHebrew).toContain("תמוז");
    expect(m.years).toBe(13);
    expect(m.nextAnniversary).toBe("2027-07-20");
  });
  it("death after sunset moves to the next Hebrew day", () => {
    const a = memorialDates("2014-07-20", false, "2026-11-02");
    const b = memorialDates("2014-07-20", true, "2026-11-02");
    expect(addDays(a.nextAzkara, 1)).toBe(b.nextAzkara);
  });
  it("returns today when the memorial is today", () => {
    const m = memorialDates("2014-07-20", false, "2027-07-27");
    expect(m.nextAzkara).toBe("2027-07-27");
  });
});

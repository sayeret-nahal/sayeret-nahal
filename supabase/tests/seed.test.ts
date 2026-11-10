import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addStaff, as, createDb, type Db } from "./harness";

// Loads the 3,000-person demo seed and checks acceptance criteria that depend on volume.
let db: Db;
let coord: string;

beforeAll(async () => {
  db = await createDb();
  await db.exec(`update public.settings set value = 'false' where key = 'require_mfa'`);
  coord = await addStaff(db, "coord@x.org", "coordinator");
  await addStaff(db, "vol@x.org", "volunteer");
  await db.exec(readFileSync(join(__dirname, "..", "seed", "demo.sql"), "utf8"));
}, 300_000);

describe("demo seed at 3,000+ records", () => {
  it("loads the expected volume, all marked as demo", async () => {
    const r = await db.query<{ n: number; demo: number }>(`select count(*)::int n, count(*) filter (where is_demo)::int demo from public.contacts`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(3000);
    expect(r.rows[0].demo).toBe(r.rows[0].n);
  });

  it("has a realistic mix of roles and some calls already due", async () => {
    const r = await db.query<{ type_code: string; n: number }>(`select type_code, count(*)::int n from public.contact_type_links group by 1`);
    const n = Object.fromEntries(r.rows.map((x) => [x.type_code, x.n]));
    expect(n.donor).toBeGreaterThan(150);
    expect(n.donor).toBeLessThan(400);
    expect(n.wounded).toBeGreaterThan(50);
    expect(n.reservist).toBeLessThan(1500);
    const due = await db.query<{ n: number }>(`select count(*)::int n from public.contact_care where next_contact_at <= current_date`);
    expect(due.rows[0].n).toBeGreaterThan(50);
  });

  it("finds a person among 3,000 quickly (acceptance #1)", async () => {
    const name = (await db.query<{ full_name: string }>(`select full_name from public.contacts where is_demo order by random() limit 1`)).rows[0].full_name;
    const t0 = performance.now();
    const r = await as(db, coord, (tx) => tx.query<{ full_name: string }>(`select full_name from public.search_contacts($1, 20)`, [name]));
    const ms = performance.now() - t0;
    expect(r.rows.map((x) => x.full_name)).toContain(name);
    expect(ms).toBeLessThan(1500); // in-process WASM Postgres; a real server is much faster
    console.log(`search among 3,000 took ${ms.toFixed(0)} ms (PGlite)`);
  });

  it("first calls of newly added people are spread over time, not all due today", async () => {
    await db.query(`insert into public.contacts (first_name, source) select 'חדש' || g, 'test-new' from generate_series(1, 300) g`);
    const r = await db.query<{ due: number; total: number }>(`select count(*) filter (where cc.next_contact_at <= current_date)::int due, count(*)::int total
      from public.contact_care cc join public.contacts c on c.id = cc.contact_id where c.source = 'test-new'`);
    expect(r.rows[0].total).toBe(300);
    expect(r.rows[0].due).toBe(0);
  });

  it("flags red alerts in seeded cases", async () => {
    const r = await as(db, coord, (tx) => tx.query<{ overdue: number; unassigned: number }>(
      `select count(*) filter (where overdue)::int overdue, count(*) filter (where unassigned)::int unassigned from public.case_alerts`));
    expect(r.rows[0].overdue).toBeGreaterThan(0);
    expect(r.rows[0].unassigned).toBeGreaterThan(0);
  });

  it("duplicate detection runs on the full data set", async () => {
    const t0 = performance.now();
    await as(db, coord, (tx) => tx.query(`select * from public.find_duplicates(50)`));
    console.log(`find_duplicates over 3,000 took ${(performance.now() - t0).toFixed(0)} ms (PGlite)`);
  });

  it("impact report works on the seeded data", async () => {
    const r = await as(db, coord, (tx) => tx.query<{ r: Record<string, number | boolean> }>(`select public.impact_report_safe(current_date - 365, current_date) r`));
    expect(r.rows[0].r.includes_demo).toBe(true);
    expect(Number(r.rows[0].r.people_reached)).toBeGreaterThan(0);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

// 0008: "הרשימה הורודה" — the pink type, and last_paid_at kept in sync with donations.
let db: Db;
const id: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  id.admin = await addStaff(db, "admin@x.org", "admin");
  id.donorc = await addStaff(db, "donors@x.org", "donor_coordinator");
  id.coord = await addStaff(db, "coord@x.org", "coordinator");
  id.person = (await db.query<{ id: string }>(`insert into public.contacts (first_name) values ('נהנה משירות') returning id`)).rows[0].id;
  await db.query(`insert into public.contact_type_links values ($1, 'pink')`, [id.person]);
});

const lastPaid = async () =>
  (await db.query<{ d: string | null }>(`select last_paid_at::text d from public.contacts where id = $1`, [id.person])).rows[0].d;

describe("pink list", () => {
  it("has its own contact type", async () => {
    const r = await db.query<{ label: string; is_sensitive: boolean }>(`select label, is_sensitive from public.contact_types where code = 'pink'`);
    expect(r.rows[0]).toEqual({ label: "הרשימה הורודה", is_sensitive: false });
  });

  it("tracks the latest payment as donations are recorded and removed", async () => {
    expect(await lastPaid()).toBeNull();
    await as(db, id.donorc, (tx) => tx.query(`insert into public.donations (contact_id, amount, donated_at) values ($1, 100, '2025-01-10')`, [id.person]), { keep: true });
    await as(db, id.donorc, (tx) => tx.query(`insert into public.donations (contact_id, amount, donated_at) values ($1, 50, '2026-03-01')`, [id.person]), { keep: true });
    expect(await lastPaid()).toBe("2026-03-01");
    await as(db, id.admin, (tx) => tx.query(`delete from public.donations where contact_id = $1 and donated_at = '2026-03-01'`, [id.person]), { keep: true });
    expect(await lastPaid()).toBe("2025-01-10");
  });

  it("lets other staff see whether someone pays, but not change it", async () => {
    const r = await as(db, id.coord, (tx) => tx.query<{ last_paid_at: string }>(`select last_paid_at::text from public.contacts where id = $1`, [id.person]));
    expect(r.rows[0].last_paid_at).toBe("2025-01-10");
    await expect(as(db, id.coord, (tx) => tx.query(`update public.contacts set last_paid_at = now() where id = $1`, [id.person])))
      .rejects.toThrow(/permission denied/);
  });
});

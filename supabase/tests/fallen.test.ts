import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

// 0007: fallen details and who in the community is connected to each fallen soldier.
let db: Db;
const id: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  const cohort = (await db.query<{ id: number }>(`insert into public.cohorts (label) values ('אוגוסט 2019') returning id`)).rows[0].id;
  const other = (await db.query<{ id: number }>(`insert into public.cohorts (label) values ('מרץ 2020') returning id`)).rows[0].id;
  id.coord = await addStaff(db, "coord@x.org", "coordinator");
  id.donorc = await addStaff(db, "donors@x.org", "donor_coordinator");
  const mk = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  id.mate = await mk(`insert into public.contacts (first_name, cohort_id, city) values ('חבר מחזור', $1, 'חיפה') returning id`, [cohort]);
  id.neighbor = await mk(`insert into public.contacts (first_name, cohort_id, city) values ('שכן', $1, 'כפר עזה') returning id`, [other]);
  id.both = await mk(`insert into public.contacts (first_name, cohort_id, city) values ('גם וגם', $1, 'קיבוץ כפר עזה') returning id`, [cohort]);
  id.none = await mk(`insert into public.contacts (first_name, cohort_id, city) values ('אחר', $1, 'אילת') returning id`, [other]);
  id.archived = await mk(`insert into public.contacts (first_name, cohort_id, city, archived_at) values ('בארכיון', $1, 'כפר עזה', now()) returning id`, [cohort]);
  id.fallen = await mk(
    `insert into public.fallen (first_name, last_name, death_date, cohort_id, residence, burial_place, war_operation, enlistment_text, enlistment_year)
     values ('א', 'ב', '2023-10-07', $1, 'קיבוץ כפר עזה', 'בית העלמין הצבאי הר הרצל', 'מלחמת חרבות ברזל', '4.8.2019', 2019) returning id`,
    [cohort],
  );
});

describe("place names", () => {
  it("match across common spellings", async () => {
    const r = await db.query<{ a: string; b: string; c: string }>(
      `select public.norm_place('קיבוץ כפר עזה') a, public.norm_place(' כפר  עזה ') b, public.norm_place('תל אביב-יפו') c`,
    );
    expect(r.rows[0]).toEqual({ a: "כפר עזה", b: "כפר עזה", c: "תל אביב" });
  });
});

describe("fallen_connections", () => {
  it("links people by cohort and by town, skipping archived people", async () => {
    const r = await as(db, id.coord, (tx) =>
      tx.query<{ contact_id: string; reason: string }>(`select contact_id, reason from public.fallen_connections where fallen_id = $1 order by reason`, [id.fallen]),
    );
    const got = r.rows.map((x) => `${x.contact_id}:${x.reason}`).sort();
    expect(got).toEqual([`${id.mate}:cohort`, `${id.both}:cohort`, `${id.neighbor}:city`, `${id.both}:city`].sort());
  });

  it("shows nothing to roles that may not see the fallen list", async () => {
    const r = await as(db, id.donorc, (tx) => tx.query(`select * from public.fallen_connections`));
    expect(r.rows).toHaveLength(0);
  });
});

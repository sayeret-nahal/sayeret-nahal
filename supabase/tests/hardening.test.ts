import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

// Regression tests for the findings of the independent security review (docs/04-security-privacy.md).
let db: Db;
const id: Record<string, string> = {};
let cohortA = 0;
let cohortB = 0;

beforeAll(async () => {
  db = await createDb();
  cohortA = (await db.query<{ id: number }>(`insert into public.cohorts (label) values ('A') returning id`)).rows[0].id;
  cohortB = (await db.query<{ id: number }>(`insert into public.cohorts (label) values ('B') returning id`)).rows[0].id;
  id.admin = await addStaff(db, "admin@x.org", "admin");
  id.coord = await addStaff(db, "coord@x.org", "coordinator");
  id.lead = await addStaff(db, "lead@x.org", "cohort_lead", { cohorts: [cohortA] });
  id.donorc = await addStaff(db, "donors@x.org", "donor_coordinator");
  id.vol = await addStaff(db, "vol@x.org", "volunteer");
  const mk = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  id.vet = await mk(`insert into public.contacts (first_name, phone, cohort_id, owner_id) values ('ותיק', '+972521111111', $1, $2) returning id`, [cohortA, id.vol]);
  id.donor = await mk(`insert into public.contacts (first_name, phone, cohort_id) values ('תורם', '+972522222222', $1) returning id`, [cohortB]);
  await db.query(`insert into public.contact_type_links values ($1, 'donor')`, [id.donor]);
  await db.query(`insert into public.fallen (first_name, last_name, death_date, notes) values ('א', 'ב', '2014-07-20', 'x')`);
});

describe("H1 import reports", () => {
  it("are visible to their creator and managers only", async () => {
    await as(db, id.coord, (tx) => tx.query(`insert into public.import_batches (kind, file_name, report) values ('contacts', 'wounded.xlsx', '{"typeCode":"wounded"}')`), { keep: true });
    const d = await as(db, id.donorc, (tx) => tx.query(`select * from public.import_batches`));
    expect(d.rows).toHaveLength(0);
    const m = await as(db, id.admin, (tx) => tx.query(`select * from public.import_batches`));
    expect(m.rows).toHaveLength(1);
    await expect(as(db, id.donorc, (tx) => tx.query(`insert into public.import_batches (kind, created_by) values ('donations', $1)`, [id.coord])))
      .rejects.toThrow(/row-level security/);
  });
});

describe("H2 public forms cannot be shut down", () => {
  it("a flood is flagged, not rejected", async () => {
    await as(db, null, async (tx) => {
      for (let i = 0; i < 31; i++) {
        await tx.query(`select public.submit_concern('מדווח', $1, 'חבר', null, null, null)`, [`05000${String(10000 + i)}`]);
      }
      const r = await tx.query<{ ref: number }>(`select public.submit_talk_request('אמיתי', '0549999999', 'phone', null, null) ref`);
      expect(Number(r.rows[0].ref)).toBeGreaterThan(0);
    }, { keep: true });
    const spam = await db.query<{ n: number }>(`select count(*)::int n from public.cases where suspected_spam and source = 'concern_form'`);
    expect(spam.rows[0].n).toBeGreaterThan(0);
    const real = await db.query<{ suspected_spam: boolean }>(`select suspected_spam from public.cases where requester_phone = '+972549999999'`);
    expect(real.rows[0].suspected_spam).toBe(false); // separate budget per form
  });
});

describe("M2 protected contact columns and scope", () => {
  it("nobody can mark real people as demo data or archive them via the API", async () => {
    await expect(as(db, id.donorc, (tx) => tx.query(`update public.contacts set is_demo = true where id = $1`, [id.donor])))
      .rejects.toThrow(/permission denied/);
    await expect(as(db, id.coord, (tx) => tx.query(`update public.contacts set archived_at = now() where id = $1`, [id.vet])))
      .rejects.toThrow(/permission denied/);
    await expect(as(db, id.coord, (tx) => tx.query(`insert into public.contacts (first_name, is_demo) values ('x', true)`)))
      .rejects.toThrow(/permission denied/);
  });

  it("archiving goes through the managers-only function", async () => {
    await expect(as(db, id.coord, (tx) => tx.query(`select public.set_contact_archived($1, true)`, [id.vet]))).rejects.toThrow(/רק מנהל/);
    const r = await as(db, id.admin, async (tx) => {
      await tx.query(`select public.set_contact_archived($1, true)`, [id.vet]);
      return tx.query<{ a: boolean }>(`select archived_at is not null a from public.contacts where id = $1`, [id.vet]);
    });
    expect(r.rows[0].a).toBe(true);
  });

  it("a cohort lead cannot move a record out of their scope", async () => {
    await expect(as(db, id.lead, (tx) => tx.query(`update public.contacts set cohort_id = $2, owner_id = auth.uid() where id = $1`, [id.vet, cohortB])))
      .rejects.toThrow(/שבאחריותך/);
  });
});

describe("M3 attribution and history cannot be forged", () => {
  it("created_by is pinned on insert and immutable on update", async () => {
    await expect(as(db, id.vol, (tx) => tx.query(`insert into public.cases (contact_id, message, created_by) values ($1, 'x', $2)`, [id.vet, id.coord])))
      .rejects.toThrow(/row-level security/);
    const r = await as(db, id.coord, async (tx) => {
      const c = await tx.query<{ id: string }>(`insert into public.cases (contact_id, message, assignee_id) values ($1, 'x', $2) returning id`, [id.vet, id.vol]);
      return c.rows[0].id;
    }, { keep: true });
    await as(db, id.vol, (tx) => tx.query(`update public.cases set created_by = auth.uid() where id = $1`, [r]), { keep: true });
    const after = await db.query<{ created_by: string }>(`select created_by from public.cases where id = $1`, [r]);
    expect(after.rows[0].created_by).toBe(id.coord);
  });

  it("clients can only add notes and calls to a case history", async () => {
    await as(db, id.coord, async (tx) => {
      const c = await tx.query<{ id: string }>(`insert into public.cases (contact_id, message) values ($1, 'x') returning id`, [id.vet]);
      await expect(tx.query(`insert into public.case_events (case_id, kind, body) values ($1, 'resolved', 'fake')`, [c.rows[0].id]))
        .rejects.toThrow(/row-level security/);
    });
  });

  it("task completion is attributed to whoever completed it", async () => {
    const r = await as(db, id.coord, async (tx) => {
      const t = await tx.query<{ id: string }>(`insert into public.tasks (title, assignee_id) values ('x', auth.uid()) returning id`);
      await tx.query(`update public.tasks set status = 'done', completed_by = $2 where id = $1`, [t.rows[0].id, id.admin]);
      return tx.query<{ completed_by: string }>(`select completed_by from public.tasks where id = $1`, [t.rows[0].id]);
    });
    expect(r.rows[0].completed_by).toBe(id.coord);
  });
});

describe("M4 phone matches from anonymous forms are suggestions only", () => {
  it("does not attach the case to the person automatically", async () => {
    const ref = await as(db, null, (tx) => tx.query<{ r: number }>(`select public.submit_concern('רון', '0531231234', 'ותיק', '0521111111', null, 'מודאג') r`), { keep: true });
    const c = await db.query<{ contact_id: string | null; suggested_contact_id: string }>(`select contact_id, suggested_contact_id from public.cases where ref_no = $1`, [ref.rows[0].r]);
    expect(c.rows[0]).toEqual({ contact_id: null, suggested_contact_id: id.vet });
  });
});

describe("L1/L2/L4/L7/L8", () => {
  it("internal lookup helpers are not callable from the API", async () => {
    await expect(as(db, id.vol, (tx) => tx.query(`select public.match_contact_by_phone('+972522222222')`))).rejects.toThrow(/permission denied/);
  });

  it("the access log cannot be forged or flooded", async () => {
    await expect(as(db, id.coord, (tx) => tx.query(`select public.log_access('mfa_verified')`), { aal: "aal1" })).rejects.toThrow(/not allowed/);
    await expect(as(db, id.coord, (tx) => tx.query(`select public.log_access('view', 'x', null, $1)`, [JSON.stringify({ blob: "x".repeat(5000) })])))
      .rejects.toThrow(/too large/);
  });

  it("self-update links stop working after 3 uses", async () => {
    const t = (await as(db, id.coord, (tx) => tx.query<{ t: string }>(`select public.create_update_link($1) t`, [id.donor]), { keep: true })).rows[0].t;
    for (let i = 0; i < 3; i++) {
      await as(db, null, (tx) => tx.query(`select public.submit_update_profile($1, $2)`, [t, JSON.stringify({ first_name: "תורם" })]), { keep: true });
    }
    const p = await as(db, null, (tx) => tx.query<{ p: unknown }>(`select public.get_update_profile($1) p`, [t]));
    expect(p.rows[0].p).toBeNull();
  });

  it("volunteers cannot create self-update links", async () => {
    await expect(as(db, id.vol, (tx) => tx.query(`select public.create_update_link($1)`, [id.vet]))).rejects.toThrow(/הרשאה/);
  });

  it("donor staff do not see fallen records or care metrics", async () => {
    const f = await as(db, id.donorc, (tx) => tx.query(`select * from public.fallen`));
    expect(f.rows).toHaveLength(0);
    const r = await as(db, id.donorc, (tx) => tx.query<{ r: Record<string, unknown> }>(`select public.impact_report_safe(current_date - 30, current_date) r`));
    expect(r.rows[0].r).not.toHaveProperty("talk_requests");
    expect(r.rows[0].r).toHaveProperty("donations_sum");
    await expect(as(db, id.donorc, (tx) => tx.query(`select public.impact_report(current_date - 30, current_date)`))).rejects.toThrow(/permission denied/);
  });
});

describe("case assignment", () => {
  it("cannot assign a case to donor staff, who could not see it", async () => {
    await expect(as(db, id.coord, (tx) => tx.query(`insert into public.cases (message, assignee_id) values ('x', $1)`, [id.donorc])))
      .rejects.toThrow(/מורשה לראות פניות/);
  });
});

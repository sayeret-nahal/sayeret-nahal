import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

let db: Db;
const ids: Record<string, string> = {};
let cohortA = 0;
let cohortB = 0;
let regionNorth = 0;

async function newContact(fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  const r = await db.query<{ id: string }>(
    `insert into public.contacts (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(fields),
  );
  return r.rows[0].id;
}
async function tag(contact: string, type: string) {
  await db.query(`insert into public.contact_type_links (contact_id, type_code) values ($1, $2)`, [contact, type]);
}

beforeAll(async () => {
  db = await createDb();
  await db.exec(`update public.settings set value = 'true' where key = 'require_mfa'`);
  cohortA = (await db.query<{ id: number }>(`insert into public.cohorts (label) values ('נובמבר 2012') returning id`)).rows[0].id;
  cohortB = (await db.query<{ id: number }>(`insert into public.cohorts (label) values ('מרץ 2015') returning id`)).rows[0].id;
  regionNorth = (await db.query<{ id: number }>(`select id from public.regions where label = 'צפון'`)).rows[0].id;

  ids.admin = await addStaff(db, "admin@x.org", "admin");
  ids.coord = await addStaff(db, "coord@x.org", "coordinator");
  ids.lead = await addStaff(db, "lead@x.org", "cohort_lead", { cohorts: [cohortA] });
  ids.donorc = await addStaff(db, "donors@x.org", "donor_coordinator");
  ids.vol = await addStaff(db, "vol@x.org", "volunteer");

  ids.yossi = await newContact({ first_name: "יוסי", last_name: "כהן", phone: "+972521234567", cohort_id: cohortA, region_id: regionNorth });
  ids.dana = await newContact({ first_name: "דנה", last_name: "לוי", phone: "+972541111111", cohort_id: cohortB, owner_id: ids.vol });
  ids.donor = await newContact({ first_name: "משה", last_name: "תורם", email: "moshe@x.org", cohort_id: cohortB });
  ids.dup = await newContact({ first_name: "יוסף", last_name: "כהן", phone: "+972521234567" });
  await tag(ids.yossi, "wounded");
  await tag(ids.yossi, "alumni");
  await tag(ids.donor, "donor");
});

describe("access control", () => {
  it("blocks sign-up without an invite", async () => {
    await expect(db.query(`insert into auth.users (email) values ('stranger@x.org')`)).rejects.toThrow(/הוזמנו/);
  });

  it("anon cannot read any table", async () => {
    await expect(as(db, null, (tx) => tx.query(`select * from public.contacts`))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, (tx) => tx.query(`select * from public.cases`))).rejects.toThrow(/permission denied/);
  });

  it("requires MFA (aal2) when the setting is on", async () => {
    const n = await as(db, ids.admin, (tx) => tx.query(`select count(*)::int n from public.contacts`), { aal: "aal1" });
    expect(n.rows[0]).toEqual({ n: 0 });
    const own = await as(db, ids.admin, (tx) => tx.query(`select role from public.staff where id = auth.uid()`), { aal: "aal1" });
    expect(own.rows).toHaveLength(1); // the app can still tell the user to finish MFA
  });

  it("admin and coordinator see everyone", async () => {
    for (const u of [ids.admin, ids.coord]) {
      const r = await as(db, u, (tx) => tx.query<{ n: number }>(`select count(*)::int n from public.contacts`));
      expect(r.rows[0].n).toBe(4);
    }
  });

  it("cohort lead sees only their cohort", async () => {
    const r = await as(db, ids.lead, (tx) => tx.query<{ id: string }>(`select id from public.contacts`));
    expect(r.rows.map((x) => x.id).sort()).toEqual([ids.yossi].sort());
  });

  it("volunteer sees only people assigned to them and cannot edit contact details", async () => {
    const r = await as(db, ids.vol, (tx) => tx.query<{ id: string }>(`select id from public.contacts`));
    expect(r.rows.map((x) => x.id)).toEqual([ids.dana]);
    const upd = await as(db, ids.vol, (tx) => tx.query(`update public.contacts set city = 'x' where id = $1`, [ids.dana]));
    expect(upd.affectedRows).toBe(0);
  });

  it("donor coordinator sees donors only, and no care data or sensitive tags", async () => {
    const r = await as(db, ids.donorc, (tx) => tx.query<{ id: string }>(`select id from public.contacts`));
    expect(r.rows.map((x) => x.id)).toEqual([ids.donor]);
    const care = await as(db, ids.donorc, (tx) => tx.query(`select * from public.contact_care`));
    expect(care.rows).toHaveLength(0);
    const tags = await as(db, ids.coord, (tx) =>
      tx.query(`select type_code from public.contact_type_links where contact_id = $1`, [ids.yossi]));
    expect(tags.rows).toHaveLength(2);
    const cases = await as(db, ids.donorc, (tx) => tx.query(`select * from public.cases`));
    expect(cases.rows).toHaveLength(0);
  });

  it("only admin reads the audit log, nobody can delete it", async () => {
    const a = await as(db, ids.admin, (tx) => tx.query(`select count(*)::int n from public.audit_log`));
    expect((a.rows[0] as { n: number }).n).toBeGreaterThan(0);
    const c = await as(db, ids.coord, (tx) => tx.query(`select * from public.audit_log`));
    expect(c.rows).toHaveLength(0);
    await expect(as(db, ids.admin, (tx) => tx.query(`delete from public.audit_log`))).rejects.toThrow(/permission denied/);
  });

  it("records who changed what", async () => {
    await as(db, ids.coord, (tx) => tx.query(`update public.contacts set city = 'חיפה' where id = $1`, [ids.yossi]), { keep: true });
    const r = await db.query<{ actor_id: string; changes: Record<string, unknown> }>(
      `select actor_id, changes from public.audit_log where table_name = 'contacts' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [ids.yossi]);
    expect(r.rows[0].actor_id).toBe(ids.coord);
    expect(r.rows[0].changes).toHaveProperty("city");
  });
});

describe("check-in cadence", () => {
  it("spreads the first call over the cadence for new contacts", async () => {
    const r = await db.query<{ d: number }>(`select (next_contact_at - current_date) d from public.contact_care where contact_id = $1`, [ids.yossi]);
    expect(r.rows[0].d).toBeGreaterThanOrEqual(1);
    expect(r.rows[0].d).toBeLessThanOrEqual(91);
  });

  it("brings the next call forward when status escalates to distress", async () => {
    const r = await as(db, ids.coord, async (tx) => {
      await tx.query(`update public.contact_care set status_code = 'distress' where contact_id = $1`, [ids.yossi]);
      return tx.query<{ d: number }>(`select (next_contact_at - current_date) d from public.contact_care where contact_id = $1`, [ids.yossi]);
    });
    expect(r.rows[0].d).toBeLessThanOrEqual(7);
  });

  it("logging a talk schedules the next call by cadence; needs_followup creates a task", async () => {
    const r = await as(db, ids.vol, async (tx) => {
      await tx.query(`select public.log_interaction($1, 'call', 'needs_followup', 'דיברנו', null)`, [ids.dana]);
      const care = await tx.query<{ d: number; last: string | null }>(
        `select (next_contact_at - current_date) d, last_contact_at last from public.contact_care where contact_id = $1`, [ids.dana]);
      const tasks = await tx.query(`select * from public.tasks where contact_id = $1 and assignee_id = auth.uid()`, [ids.dana]);
      return { care: care.rows[0], tasks: tasks.rows.length };
    });
    expect(r.care.d).toBe(90);
    expect(r.care.last).not.toBeNull();
    expect(r.tasks).toBe(1);
  });

  it("no answer → retry in 3 days and does not count as contact", async () => {
    const r = await as(db, ids.vol, async (tx) => {
      await tx.query(`select public.log_interaction($1, 'call', 'no_answer')`, [ids.dana]);
      return tx.query<{ d: number; last: string | null }>(
        `select (next_contact_at - current_date) d, last_contact_at last from public.contact_care where contact_id = $1`, [ids.dana]);
    });
    expect(r.rows[0]).toEqual({ d: 3, last: null });
  });

  it("volunteer cannot log a call for someone not assigned to them", async () => {
    await expect(as(db, ids.vol, (tx) => tx.query(`select public.log_interaction($1, 'call', 'talked')`, [ids.yossi])))
      .rejects.toThrow(/row-level security/);
  });
});

describe("requests, concerns and red flags", () => {
  it("public talk button creates an urgent request due in 24h, matched by phone", async () => {
    const ref = await as(db, null, (tx) =>
      tx.query<{ ref: number }>(`select public.submit_talk_request('יוסי', '052-123-4567', 'whatsapp', 'בערב', 'רוצה לדבר') ref`), { keep: true });
    expect(Number(ref.rows[0].ref)).toBeGreaterThan(0);
    const c = await db.query<{ priority: string; h: number; contact_id: string | null }>(
      `select priority, round(extract(epoch from due_at - opened_at) / 3600)::int h, suggested_contact_id as contact_id from public.cases where ref_no = $1`,
      [ref.rows[0].ref]);
    // two contacts share this phone → no automatic match (never guess who it is)
    expect(c.rows[0]).toEqual({ priority: "urgent", h: 24, contact_id: null });
  });

  it("matches a unique phone, and rate-limits repeated submissions", async () => {
    const r = await as(db, null, (tx) =>
      tx.query<{ ref: number }>(`select public.submit_talk_request('דנה', '0541111111', 'phone', null, null) ref`), { keep: true });
    const c = await db.query<{ contact_id: string }>(`select suggested_contact_id as contact_id from public.cases where ref_no = $1`, [r.rows[0].ref]);
    expect(c.rows[0].contact_id).toBe(ids.dana);
    await as(db, null, async (tx) => {
      await tx.query(`select public.submit_talk_request('דנה', '0541111111', 'phone', null, null)`);
      await tx.query(`select public.submit_talk_request('דנה', '0541111111', 'phone', null, null)`);
      await expect(tx.query(`select public.submit_talk_request('דנה', '0541111111', 'phone', null, null)`)).rejects.toThrow(/כמה פניות/);
    });
  });

  it("rejects invalid input and silently drops bots", async () => {
    await expect(as(db, null, (tx) => tx.query(`select public.submit_talk_request('x', '123', 'phone', null, null)`))).rejects.toThrow();
    const r = await as(db, null, (tx) => tx.query<{ r: number }>(`select public.submit_talk_request('בוט', '0521111111', 'phone', null, null, 'http://spam') r`));
    expect(Number(r.rows[0].r)).toBe(0);
  });

  it("a concern report is high priority with a 48h check", async () => {
    const ref = await as(db, null, (tx) => tx.query<{ r: number }>(
      `select public.submit_concern('אבי', '0501234567', 'דנה לוי', '0541111111', 'מרץ 2015', 'לא עונה כבר שבועיים') r`), { keep: true });
    const r = await db.query<{ kind: string; priority: string; h: number; contact_id: string }>(
        `select kind, priority, round(extract(epoch from due_at - opened_at)/3600)::int h, suggested_contact_id as contact_id from public.cases where ref_no = $1`,
        [ref.rows[0].r]);
    expect(r.rows[0]).toEqual({ kind: "concern", priority: "high", h: 48, contact_id: ids.dana });
  });

  it("flags unassigned and overdue requests; cannot close without documenting", async () => {
    await as(db, ids.coord, async (tx) => {
      const c = await tx.query<{ id: string }>(
        `insert into public.cases (contact_id, message, due_at) values ($1, 'בקשה לעזרה', now() - interval '1 day') returning id`, [ids.yossi]);
      const id = c.rows[0].id;
      const a = await tx.query(`select unassigned, overdue, stalled from public.case_alerts where id = $1`, [id]);
      expect(a.rows[0]).toEqual({ unassigned: true, overdue: true, stalled: false });
      await expect(tx.query(`update public.cases set status = 'resolved' where id = $1`, [id])).rejects.toThrow(/לתעד/);
    });
  });

  it("logs assignment and status automatically and flags a closure with no recorded action", async () => {
    await as(db, ids.coord, async (tx) => {
      const c = await tx.query<{ id: string }>(`insert into public.cases (contact_id, message) values ($1, 'x') returning id`, [ids.yossi]);
      const id = c.rows[0].id;
      await tx.query(`update public.cases set assignee_id = $2 where id = $1`, [id, ids.coord]);
      await tx.query(`update public.cases set status = 'resolved', resolution = 'טופל' where id = $1`, [id]);
      const ev = await tx.query<{ kind: string }>(`select kind from public.case_events where case_id = $1 order by created_at, kind`, [id]);
      expect(ev.rows.map((e) => e.kind).sort()).toEqual(["assign", "created", "resolved", "status"]);
      const a = await tx.query(`select closed_without_action from public.case_alerts where id = $1`, [id]);
      expect(a.rows[0]).toEqual({ closed_without_action: true });
    });
  });

  it("volunteers only see cases assigned to them", async () => {
    const r = await as(db, ids.vol, (tx) => tx.query(`select * from public.cases`));
    expect(r.rows).toHaveLength(0);
  });
});

describe("search, duplicates and merge", () => {
  it("finds people by partial Hebrew name, by local phone format, and tolerates a typo", async () => {
    const q = async (s: string) =>
      (await as(db, ids.coord, (tx) => tx.query<{ id: string }>(`select id from public.search_contacts($1)`, [s]))).rows.map((r) => r.id);
    expect(await q("יוסי")).toContain(ids.yossi);
    expect(await q("052-1234567")).toContain(ids.yossi);
    expect(await q("לווי")).toContain(ids.dana); // typo
    expect(await q("moshe@")).toContain(ids.donor);
  });

  it("search respects permissions", async () => {
    const r = await as(db, ids.vol, (tx) => tx.query(`select id from public.search_contacts('יוסי')`));
    expect(r.rows).toHaveLength(0);
  });

  it("detects duplicates by phone and merges with history kept", async () => {
    await as(db, ids.admin, async (tx) => {
      const d = await tx.query<{ a: string; b: string; reasons: string }>(`select * from public.find_duplicates()`);
      const pair = d.rows.find((p) => [p.a, p.b].includes(ids.yossi) && [p.a, p.b].includes(ids.dup));
      expect(pair?.reasons).toContain("טלפון");
      await tx.query(`select public.log_interaction($1, 'call', 'talked')`, [ids.dup]);
      await tx.query(`select public.merge_contacts($1, $2)`, [ids.yossi, ids.dup]);
      const moved = await tx.query(`select * from public.interactions where contact_id = $1`, [ids.yossi]);
      expect(moved.rows.length).toBeGreaterThan(0);
      const dropped = await tx.query<{ merged_into: string }>(`select merged_into from public.contacts where id = $1`, [ids.dup]);
      expect(dropped.rows[0].merged_into).toBe(ids.yossi);
    });
  });

  it("only admin/manager may merge", async () => {
    await expect(as(db, ids.coord, (tx) => tx.query(`select public.merge_contacts($1, $2)`, [ids.yossi, ids.dup])))
      .rejects.toThrow(/רק מנהל/);
  });

  it("phone normalisation", async () => {
    const r = await db.query<{ a: string; b: string; c: string; d: string | null; e: string }>(
      `select public.normalize_il_phone('052-123 4567') a, public.normalize_il_phone('+972 52 1234567') b,
              public.normalize_il_phone('04-8123456') c, public.normalize_il_phone('12') d,
              public.normalize_il_phone('00972521234567') e`);
    expect(r.rows[0]).toEqual({ a: "+972521234567", b: "+972521234567", c: "+97248123456", d: null, e: "+972521234567" });
  });
});

describe("self-update link", () => {
  it("lets a person confirm their own details with a personal link", async () => {
    const token = await as(db, ids.coord, (tx) => tx.query<{ t: string }>(`select public.create_update_link($1) t`, [ids.dana]), { keep: true });
    const t = token.rows[0].t;
    const profile = await as(db, null, (tx) => tx.query<{ p: { first_name: string; phone: string } }>(`select public.get_update_profile($1) p`, [t]));
    expect(profile.rows[0].p.first_name).toBe("דנה");
    expect(profile.rows[0].p.phone).toBe("0541111111");
    await as(db, null, (tx) => tx.query(`select public.submit_update_profile($1, $2)`, [t, JSON.stringify({
      first_name: "דנה", last_name: "לוי", phone: "054-1111111", email: "dana@x.org", profession: "עורכת דין",
      skills: ["משפטים", "גישור"], available_to_help: true, skills_share_consent: true, campaign_consent: false,
    })]), { keep: true });
    const c = await db.query<{ verified_by: string; skills: string[]; email: string }>(`select verified_by, skills, email from public.contacts where id = $1`, [ids.dana]);
    expect(c.rows[0].verified_by).toBe("self");
    expect(c.rows[0].skills.sort()).toEqual(["גישור", "משפטים"]);
    const bad = await as(db, null, (tx) => tx.query<{ p: unknown }>(`select public.get_update_profile('nope') p`));
    expect(bad.rows[0].p).toBeNull();
  });
});

describe("reports", () => {
  it("impact report returns aggregates for managers and refuses volunteers", async () => {
    const r = await as(db, ids.coord, (tx) =>
      tx.query<{ r: Record<string, number> }>(`select public.impact_report_safe(current_date - 30, current_date) r`));
    expect(r.rows[0].r).toHaveProperty("people_reached");
    expect(r.rows[0].r.community_size).toBeGreaterThan(0);
    await expect(as(db, ids.vol, (tx) => tx.query(`select public.impact_report_safe(current_date - 30, current_date)`))).rejects.toThrow(/הרשאה/);
  });
});

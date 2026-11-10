import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

// 0009: payments → members, consumer-club purchases, website inquiries, broadcasts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let db: Db;
const id: Record<string, string> = {};
const SECRET = "test-ingest-secret-0123456789abcdef";

const types = async (contact: string) =>
  (await db.query<{ t: string }>(`select type_code t from public.contact_type_links where contact_id = $1 order by 1`, [contact])).rows.map((r) => r.t);

beforeAll(async () => {
  db = await createDb();
  id.admin = await addStaff(db, "admin@x.org", "admin");
  id.manager = await addStaff(db, "manager@x.org", "manager");
  id.coord = await addStaff(db, "coord@x.org", "coordinator");
  id.vol = await addStaff(db, "vol@x.org", "volunteer");
  await as(db, id.admin, (tx) => tx.query<Row>(`select public.set_ingest_secret($1)`, [SECRET]), { keep: true });
  id.existing = (await db.query<{ id: string }>(
    `insert into public.contacts (first_name, last_name, phone, campaign_consent) values ('קיים', 'במערכת', '+972521234567', true) returning id`,
  )).rows[0].id;
});

describe("ingest secret", () => {
  it("only an admin can set it, and wrong secrets are refused", async () => {
    await expect(as(db, id.coord, (tx) => tx.query<Row>(`select public.set_ingest_secret($1)`, [SECRET]))).rejects.toThrow();
    await expect(as(db, null, (tx) => tx.query<Row>(`select public.ingest_payment('wrong-secret-wrong-secret-xx', 'grow', '{"external_id":"1","amount":5}')`)))
      .rejects.toThrow(/unauthorized/);
    const r = await as(db, null, (tx) => tx.query<Row>(`select secret_hash from public.integration_secrets`)).catch((e) => e);
    expect(String(r)).toMatch(/permission denied/);
  });
});

describe("payments", () => {
  const pay = (provider: string, ev: object) =>
    as(db, null, (tx) => tx.query<{ r: { status: string; contact_id?: string; created?: boolean } }>(
      `select public.ingest_payment($1, $2, $3::jsonb) r`, [SECRET, provider, JSON.stringify(ev)]), { keep: true });

  it("a new payer becomes a member and donor, with the donation recorded", async () => {
    const r = (await pay("jgive", { external_id: "T1", full_name: "דנה לוי", phone: "054-765-4321", email: "Dana@Example.org", amount: 180, paid_at: "2026-10-01", recurring: true, marketing_consent: true })).rows[0].r;
    expect(r.status).toBe("processed");
    expect(r.created).toBe(true);
    const c = (await db.query<Row>(`select first_name, last_name, phone, email, member_since::text, last_paid_at::text, campaign_consent, source from public.contacts where id = $1`, [r.contact_id])).rows[0];
    expect(c).toMatchObject({ first_name: "דנה", last_name: "לוי", phone: "+972547654321", email: "dana@example.org", member_since: "2026-10-01", last_paid_at: "2026-10-01", campaign_consent: true, source: "jgive" });
    expect(await types(r.contact_id!)).toEqual(["donor", "member"]);
    const d = (await db.query<Row>(`select amount::int, is_recurring, source, external_ref from public.donations where contact_id = $1`, [r.contact_id])).rows[0];
    expect(d).toEqual({ amount: 180, is_recurring: true, source: "jgive", external_ref: "jgive:T1" });
  });

  it("a retry of the same transaction is ignored", async () => {
    const r = (await pay("jgive", { external_id: "T1", full_name: "דנה לוי", phone: "0547654321", amount: 180 })).rows[0].r;
    expect(r.status).toBe("duplicate");
    expect((await db.query<Row>(`select count(*)::int n from public.donations where external_ref = 'jgive:T1'`)).rows[0].n).toBe(1);
  });

  it("matches an existing person by phone instead of creating a duplicate", async () => {
    const r = (await pay("grow", { external_id: "G9", full_name: "שם אחר", phone: "0521234567", amount: 50, paid_at: "2026-09-01" })).rows[0].r;
    expect(r.contact_id).toBe(id.existing);
    expect(r.created).toBe(false);
    const c = (await db.query<Row>(`select first_name from public.contacts where id = $1`, [id.existing])).rows[0];
    expect(c.first_name).toBe("קיים"); // staff data is not overwritten
  });

  it("a refund stops counting as a payment", async () => {
    await pay("grow", { external_id: "G9", kind: "refund" });
    const c = (await db.query<Row>(`select last_paid_at from public.contacts where id = $1`, [id.existing])).rows[0];
    expect(c.last_paid_at).toBeNull();
  });

  it("bad data is logged as an error, not lost", async () => {
    const r = (await pay("grow", { external_id: "BAD1", full_name: "בלי טלפון", amount: 10 })).rows[0].r;
    expect(r.status).toBe("error");
    const e = (await db.query<Row>(`select status, error from public.integration_events where external_id = 'BAD1'`)).rows[0];
    expect(e.status).toBe("error");
    expect(e.error).toMatch(/missing phone and email/);
  });
});

describe("consumer club purchases", () => {
  it("record use of the association's services and put the person on the pink list", async () => {
    const r = (await as(db, null, (tx) => tx.query<{ r: { contact_id: string } }>(
      `select public.ingest_benefit_usage($1, 'nexus', $2::jsonb) r`,
      [SECRET, JSON.stringify({ external_id: "N1", full_name: "יוסי כהן", phone: "0501112233", used_at: "2026-10-05", description: "מקרר", amount: 3200 })]), { keep: true })).rows[0].r;
    expect(await types(r.contact_id)).toEqual(["pink"]);
    const u = (await db.query<Row>(`select provider, description, amount::int from public.benefit_usages where contact_id = $1`, [r.contact_id])).rows[0];
    expect(u).toEqual({ provider: "nexus", description: "מקרר", amount: 3200 });
    const seen = await as(db, id.coord, (tx) => tx.query<Row>(`select 1 from public.benefit_usages where contact_id = $1`, [r.contact_id]));
    expect(seen.rows).toHaveLength(1);
  });
});

describe("website inquiries", () => {
  it("are routed by topic to the assigned staff member", async () => {
    await db.query<Row>(`update public.inquiry_topics set assignee_id = $1 where code = 'welfare'`, [id.coord]);
    const topics = await as(db, null, (tx) => tx.query<Row>(`select code from public.public_inquiry_topics()`));
    expect(topics.rows.map((t) => t.code)).toContain("social");
    await as(db, null, (tx) => tx.query<Row>(`select public.submit_inquiry('welfare', 'רון', '0539998877', 'ron@x.org', 'צריך עזרה בשכר דירה', true, 'https://site/welfare')`), { keep: true });
    const c = (await db.query<Row>(`select category, source, priority, assignee_id, requester_email, requester_consent, origin_page from public.cases where requester_phone = '+972539998877'`)).rows[0];
    expect(c).toMatchObject({ category: "welfare", source: "website", priority: "high", assignee_id: id.coord, requester_email: "ron@x.org", requester_consent: true, origin_page: "https://site/welfare" });
  });

  it("refuse unknown topics and bad input", async () => {
    await expect(as(db, null, (tx) => tx.query<Row>(`select public.submit_inquiry('nope', 'רון', '0539998877', null, 'x y')`))).rejects.toThrow(/נושא/);
    await expect(as(db, null, (tx) => tx.query<Row>(`select public.submit_inquiry('social', 'רון', '123', null, 'שלום')`))).rejects.toThrow(/טלפון/);
  });
});

describe("broadcasts", () => {
  let bid = "";
  it("drafts by staff, approval only by management, only to people who consented", async () => {
    await db.query<Row>(`insert into public.contacts (first_name, phone, campaign_consent) values ('לא הסכים', '+972501010101', false)`);
    const t = (await db.query<{ id: number }>(
      `insert into public.message_templates (name, channel, provider_template, body, variables) values ('עדכון', 'whatsapp', 'update_1', 'שלום {{1}}, {{2}}', '{first_name,custom}') returning id`,
    )).rows[0].id;
    bid = (await as(db, id.coord, (tx) => tx.query<{ id: string }>(
      `insert into public.broadcasts (title, template_id, custom_values, filters) values ('מפגש', $1, '{"",ערב מחזור}', '{}') returning id`, [t]), { keep: true })).rows[0].id;
    await expect(as(db, id.coord, (tx) => tx.query<Row>(`select public.queue_broadcast($1)`, [bid]))).rejects.toThrow(/הנהלה/);
    const q = (await as(db, id.manager, (tx) => tx.query<{ r: { queued: number; skipped_no_consent: number } }>(`select public.queue_broadcast($1) r`, [bid]), { keep: true })).rows[0].r;
    expect(q.queued).toBe(2); // existing person + Dana (consent from payment)
    expect(q.skipped_no_consent).toBeGreaterThanOrEqual(1);
    const vars = (await db.query<Row>(`select vars from public.broadcast_recipients where contact_id = $1`, [id.existing])).rows[0].vars;
    expect(vars).toEqual(["קיים", "ערב מחזור"]);
  });

  it("the worker sends, and an opt-out reply removes consent before the next send", async () => {
    await as(db, null, (tx) => tx.query<Row>(`select public.ingest_message_event($1, $2::jsonb)`,
      [SECRET, JSON.stringify({ kind: "inbound", phone: "0521234567", text: "הסר" })]), { keep: true });
    const consent = (await db.query<Row>(`select campaign_consent from public.contacts where id = $1`, [id.existing])).rows[0].campaign_consent;
    expect(consent).toBe(false);
    const batch = (await as(db, null, (tx) => tx.query<{ recipient_id: string; phone: string }>(`select * from public.claim_broadcast_batch($1, 10)`, [SECRET]), { keep: true })).rows;
    expect(batch).toHaveLength(1); // the opted-out person was skipped
    await as(db, null, (tx) => tx.query<Row>(`select public.report_broadcast_results($1, $2::jsonb)`,
      [SECRET, JSON.stringify(batch.map((b) => ({ id: b.recipient_id, ok: true, message_id: "m-" + b.recipient_id })))]), { keep: true });
    const b = (await db.query<Row>(`select status from public.broadcasts where id = $1`, [bid])).rows[0];
    expect(b.status).toBe("sent");
    await as(db, null, (tx) => tx.query<Row>(`select public.ingest_message_event($1, $2::jsonb)`,
      [SECRET, JSON.stringify({ kind: "status", message_id: "m-" + batch[0].recipient_id, status: "delivered" })]), { keep: true });
    const r = (await db.query<Row>(`select status from public.broadcast_recipients where provider_message_id = $1`, ["m-" + batch[0].recipient_id])).rows[0];
    expect(r.status).toBe("delivered");
  });

  it("volunteers cannot see broadcasts", async () => {
    const r = await as(db, id.vol, (tx) => tx.query<Row>(`select * from public.broadcasts`));
    expect(r.rows).toHaveLength(0);
  });
});

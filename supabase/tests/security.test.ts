import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, as, createDb, type Db } from "./harness";

// 0010: the shared public-demo admin account is contained; real admins are not affected.
let db: Db;
const id: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  id.real = await addStaff(db, "real-admin@x.org", "admin");
  id.demo = await addStaff(db, "demo-admin@example.org", "admin");
  id.demoMgr = await addStaff(db, "demo-manager@example.org", "manager");
  await db.query(`insert into public.contacts (first_name, phone, campaign_consent) values ('א', '+972521111111', true)`);
});

describe("public demo containment", () => {
  it("marks demo accounts automatically and the flag cannot be changed through the API", async () => {
    const r = await db.query<{ email: string; is_demo: boolean }>(`select email, is_demo from public.staff order by email`);
    expect(r.rows.find((x) => x.email === "demo-admin@example.org")?.is_demo).toBe(true);
    expect(r.rows.find((x) => x.email === "real-admin@x.org")?.is_demo).toBe(false);
    const r1 = await as(db, id.demo, (tx) => tx.query(`update public.staff set is_demo = false where id = $1 returning id`, [id.demo]));
    expect(r1.rows).toHaveLength(0); // demo accounts cannot update staff at all
    await as(db, id.real, (tx) => tx.query(`update public.staff set is_demo = true where id = $1`, [id.real]), { keep: true });
    const r2 = await db.query<{ is_demo: boolean }>(`select is_demo from public.staff where id = $1`, [id.real]);
    expect(r2.rows[0].is_demo).toBe(false); // always derived from the e-mail
  });

  it("a demo admin cannot invite, change staff, change settings or set the integration secret", async () => {
    await expect(as(db, id.demo, (tx) => tx.query(`insert into public.staff_invites (email, full_name, role) values ('evil@x.org', 'x', 'admin')`)))
      .rejects.toThrow(/row-level security/);
    const upd = await as(db, id.demo, (tx) => tx.query(`update public.staff set role = 'volunteer' where id = $1 returning id`, [id.real]));
    expect(upd.rows).toHaveLength(0);
    const s = await as(db, id.demo, (tx) => tx.query(`update public.settings set value = 'false' where key = 'require_mfa' returning key`));
    expect(s.rows).toHaveLength(0);
    await expect(as(db, id.demo, (tx) => tx.query(`select public.set_ingest_secret($1)`, ["x".repeat(40)]))).rejects.toThrow();
  });

  it("a demo manager cannot approve broadcasts or add templates", async () => {
    const t = (await db.query<{ id: number }>(`insert into public.message_templates (name, channel, provider_template, body) values ('תבנית', 'whatsapp', 'x', 'שלום') returning id`)).rows[0].id;
    const b = (await db.query<{ id: string }>(`insert into public.broadcasts (title, template_id) values ('הודעה', $1) returning id`, [t])).rows[0].id;
    await expect(as(db, id.demoMgr, (tx) => tx.query(`select public.queue_broadcast($1)`, [b]))).rejects.toThrow(/הנהלה/);
    await expect(as(db, id.demoMgr, (tx) => tx.query(`insert into public.message_templates (name, channel, body) values ('תבנית 2', 'sms', 'פרסומת: x')`)))
      .rejects.toThrow(/row-level security/);
  });

  it("a real admin still can", async () => {
    await as(db, id.real, (tx) => tx.query(`insert into public.staff_invites (email, full_name, role) values ('ok@x.org', 'x', 'coordinator')`));
    await as(db, id.real, (tx) => tx.query(`select public.set_ingest_secret($1)`, ["y".repeat(40)]));
  });

  it("anonymous users cannot call the permission helpers", async () => {
    await expect(as(db, null, (tx) => tx.query(`select public.can_send_broadcast()`))).rejects.toThrow(/permission denied/);
  });
});

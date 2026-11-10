// Smoke test of the local database layer without PostgREST: start, migrate, seed, query as roles.
import pg from "pg";
import { connString, seedDemo, startDb } from "./db.mjs";

const db = await startDb({ log: console.log });
await seedDemo(console.log);
const c = new pg.Client({ connectionString: connString() });
await c.connect();
const r = await c.query(`select (select count(*) from public.contacts)::int contacts, (select count(*) from public.staff)::int staff,
  (select count(*) from public.cases)::int cases, (select count(*) from public.contact_care where next_contact_at <= current_date)::int due`);
console.log(r.rows[0]);
const staff = await c.query(`select id, role from public.staff order by role`);
for (const s of staff.rows) {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.id, role: "authenticated", aal: "aal1" })]);
  const v = await c.query(`select (select count(*) from public.contacts)::int contacts, (select count(*) from public.cases)::int cases, (select count(*) from public.contact_care)::int care`);
  await c.query("rollback");
  console.log(s.role.padEnd(18), v.rows[0]);
}
await c.end();
await db.stop();

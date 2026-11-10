// Runs the real migrations on an in-process Postgres 17 (PGlite) with a minimal stand-in
// for Supabase's auth schema and roles, so RLS and SQL logic can be tested without Docker.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_STUB = `
create schema if not exists extensions;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
-- Supabase's default grants (RLS is what actually protects the data)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export async function createDb() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const dir = join(__dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  // grants on objects created after default privileges were set are covered;
  // the stub also needs grants on views created in migrations
  await db.exec(`grant select on public.case_alerts, public.contact_health to authenticated;`);
  return db;
}

export type Db = PGlite;
export type Tx = Transaction;

/** Run fn as an authenticated user (or anon when uid is null), always rolled back unless keep=true. */
export async function as<T>(
  db: Db,
  uid: string | null,
  fn: (tx: Tx) => Promise<T>,
  opts: { aal?: "aal1" | "aal2"; keep?: boolean } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role: "authenticated", aal: opts.aal ?? "aal2" } : { role: "anon" }),
    ]);
    const out = await fn(tx);
    if (!opts.keep) await tx.rollback();
    return out;
  });
}

/** Create an invited staff user and return its id. */
export async function addStaff(
  db: Db,
  email: string,
  role: string,
  scope: { cohorts?: number[]; regions?: number[] } = {},
) {
  await db.query(
    `insert into public.staff_invites (email, full_name, role, cohort_scope, region_scope) values ($1, $2, $3, $4, $5)`,
    [email, email.split("@")[0], role, scope.cohorts ?? [], scope.regions ?? []],
  );
  const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
  return r.rows[0].id;
}

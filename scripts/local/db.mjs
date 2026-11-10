// Local, Docker-free stand-in for a Supabase project: a real PostgreSQL 17 with the same
// roles, `auth` schema shape and grants that Supabase has, so the real migrations and RLS run unchanged.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const LOCAL = join(ROOT, ".local");
export const PG_PORT = 54322;

const SUPERUSER = { user: "postgres", password: "postgres" };

/** Secrets for this machine only (never committed): JWT secret + DB password for PostgREST. */
export function localSecrets() {
  mkdirSync(LOCAL, { recursive: true });
  const file = join(LOCAL, "secrets.json");
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({
      jwtSecret: randomBytes(48).toString("base64url"),
      authenticatorPassword: randomBytes(18).toString("base64url"),
    }, null, 2), { mode: 0o600 });
  }
  const secrets = JSON.parse(readFileSync(file, "utf8"));
  // integration secrets (webhooks, broadcast sender) — added later, so filled in for older installs too
  if (!secrets.ingestSecret) {
    Object.assign(secrets, {
      ingestSecret: randomBytes(24).toString("hex"),
      hookKey: randomBytes(16).toString("hex"),
      cronSecret: randomBytes(16).toString("hex"),
    });
    writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  return secrets;
}

export function connString(user = SUPERUSER.user, password = SUPERUSER.password) {
  return `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${PG_PORT}/postgres`;
}

const SUPABASE_SHAPE = (authenticatorPassword) => `
create schema if not exists extensions;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role authenticator login noinherit password '${authenticatorPassword}';
grant anon, authenticated to authenticator;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table auth.mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  factor_id uuid not null references auth.mfa_factors (id) on delete cascade,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create table auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  aal text not null default 'aal1',
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
-- same definitions Supabase uses (PostgREST sets request.jwt.claims)
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export async function startDb({ fresh = false, log = console.log } = {}) {
  const dataDir = join(LOCAL, "pgdata");
  const isNew = !existsSync(join(dataDir, "PG_VERSION"));
  const pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    ...SUPERUSER,
    port: PG_PORT,
    persistent: true,
    onLog: () => {},
    onError: (e) => log(`[postgres] ${e}`),
  });
  if (isNew || fresh) await pgServer.initialise();
  await pgServer.start();
  if (isNew || fresh) await bootstrap(log);
  return pgServer;
}

async function bootstrap(log) {
  const { authenticatorPassword } = localSecrets();
  const c = new pg.Client({ connectionString: connString() });
  await c.connect();
  try {
    log("· יוצר מבנה תואם Supabase");
    await c.query(SUPABASE_SHAPE(authenticatorPassword));
    const dir = join(ROOT, "supabase", "migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      log(`· מריץ ${f}`);
      await c.query(readFileSync(join(dir, f), "utf8"));
    }
    // local convenience: two-factor login is off by default here (turn it on in ניהול ← הגדרות)
    await c.query(`update public.settings set value = 'false' where key = 'require_mfa'`);
    await c.query(`notify pgrst, 'reload schema'`);
  } finally {
    await c.end();
  }
}

/** Test staff (one per role) + 3,000 fictional people. Passwords are written to .local/test-accounts.txt. */
export async function seedDemo(log = console.log) {
  const c = new pg.Client({ connectionString: connString() });
  await c.connect();
  try {
    const { rows } = await c.query(`select count(*)::int n from public.staff`);
    if (rows[0].n > 0) return;
    log("· יוצר חשבונות בדיקה ונתוני דוגמה");
    // cohorts come from the demo seed, so load it first, then the invites
    await c.query(readFileSync(join(ROOT, "supabase", "seed", "demo.sql"), "utf8"));
    await c.query(readFileSync(join(ROOT, "supabase", "seed", "test-staff-invites.sql"), "utf8"));
    const accounts = [
      ["qa-admin@example.org", "admin"],
      ["qa-coord@example.org", "coordinator"],
      ["qa-lead@example.org", "cohort_lead"],
      ["qa-donors@example.org", "donor_coordinator"],
      ["qa-vol@example.org", "volunteer"],
    ];
    const lines = ["חשבונות בדיקה — מחשב מקומי בלבד. לא לשימוש בסביבה אמיתית.", ""];
    for (const [email, role] of accounts) {
      const password = `Nahal-${randomBytes(6).toString("base64url")}`;
      await c.query(`insert into auth.users (email, encrypted_password) values ($1, extensions.crypt($2, extensions.gen_salt('bf')))`, [email, password]);
      lines.push(`${role.padEnd(18)} ${email.padEnd(24)} ${password}`);
    }
    // give the demo people owners so every role has real work on its home screen
    await c.query(`
      with s as (select array_agg(id order by email) ids from public.staff where role in ('coordinator','cohort_lead','volunteer','admin'))
      update public.contacts set owner_id = s.ids[1 + (abs(hashtext(contacts.id::text)) % cardinality(s.ids))]
      from s where is_demo and owner_id is null and random() < 0.85`);
    await c.query(`
      with s as (select array_agg(id) ids from public.staff where role in ('coordinator','admin'))
      update public.cases set assignee_id = s.ids[1 + (abs(hashtext(cases.id::text)) % cardinality(s.ids))]
      from s where is_demo and assignee_id is null and random() < 0.6`);
    await c.query(`update public.contacts set owner_id = (select id from public.staff where role = 'donor_coordinator')
                   where id in (select contact_id from public.contact_type_links where type_code = 'donor') and random() < 0.5`);
    writeFileSync(join(LOCAL, "test-accounts.txt"), lines.join("\n") + "\n", { mode: 0o600 });
  } finally {
    await c.end();
  }
}

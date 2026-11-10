// Regenerates supabase/bundle/*.sql from supabase/migrations (and the demo seed for the dev file).
//   node scripts/bundle.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => `supabase/migrations/${f}`);
const part = (f) => `-- ===== ${f} =====\n${readFileSync(join(ROOT, f), "utf8")}\n`;

writeFileSync(join(ROOT, "supabase", "bundle", "all-migrations.sql"),
  "-- Nahal CRM: all migrations in one file, for the Supabase SQL Editor.\n-- Generated from supabase/migrations (node scripts/bundle.mjs). Run once on an EMPTY project.\n\n" +
  migrations.map(part).join("\n"));
writeFileSync(join(ROOT, "supabase", "bundle", "dev-setup.sql"),
  "-- Nahal CRM DEV setup: all migrations + 3,000 fictional demo people + test-account invites.\n-- Run ONCE on the EMPTY dev project. Never on production.\n\n" +
  [...migrations, "supabase/seed/demo.sql", "supabase/seed/test-staff-invites.sql"].map(part).join("\n"));
console.log(`bundled ${migrations.length} migrations`);

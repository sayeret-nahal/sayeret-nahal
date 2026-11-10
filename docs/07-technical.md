# Technical documentation & maintenance

## Repository layout
```
supabase/migrations/   0001 schema · 0002 RLS + audit · 0003 business logic + public RPCs · 0004 reference data
supabase/seed/demo.sql 3,000 fictional people (is_demo = true) for testing — never in production
supabase/tests/        DB tests on in-process Postgres 17 (PGlite) with a stub of Supabase auth
src/proxy.ts           session refresh + redirect to /login (Next 16 "proxy" = middleware)
src/lib/               auth (requireStaff), data (lookups, logAccess), permissions, dates (Hebrew calendar), phone, import, notify
src/components/ui/     design system (server + client components)
src/app/(app)/         staff app: contacts, follow-up, cases, calendar, donors, skills, reports, admin, more
src/app/(public)/      no-login pages: /talk, /concern, /update/[token]
src/app/(auth)/        /login, /auth/mfa, /auth/confirm
src/app/api/           search, export (xlsx), reports/impact (xlsx), admin/permissions (csv)
docs/                  research, spec, architecture, security, user guide, launch plan, this file, acceptance
```

## Local development
```bash
cp .env.example .env.local      # fill NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                     # http://localhost:3000
npx vitest run                  # unit + DB tests (no Docker needed)
npx tsc --noEmit && npx eslint src && npx next build
```

## Setting up a Supabase project (production)
1. Create a project in **eu-central-1 (Frankfurt)** on the **Pro** plan (Free has no backups and pauses after a week).
2. Run the migrations in order (SQL editor, or `supabase db push` with the CLI): `0001` → `0006`. Do **not** run `seed/demo.sql` in production.
3. Auth settings:
   - Site URL = the app URL; Redirect URLs include `https://<app>/auth/confirm`.
   - Email confirmations ON. Minimum password length 12.
   - MFA → TOTP enabled (default).
   - Sign-ups: the `on_auth_user_created` trigger rejects any e-mail without an invite. Recommended for production: disable public sign-ups and invite users from the Supabase dashboard (Authentication → Users → Invite), after adding the `staff_invites` row.
   - Sessions: enable "Inactivity timeout" (30 min) and "Time-box user sessions" (12 h). The app also enforces idle timeout in `src/proxy.ts` (`IDLE_MINUTES`, default 30).
   - Logs: for the 24-month access-log requirement, configure a Log Drain for API logs (Team plan or an external collector).
4. Create the first admin (SQL editor, once):
   ```sql
   insert into public.staff_invites (email, full_name, role) values ('admin@example.org', 'שם מלא', 'admin');
   ```
   then sign up in the app with that e-mail ("קיבלתי הזמנה").
5. Keep `settings.require_mfa = true` (default). For a first local smoke test only, it may be set to false.
6. App env vars: see `.env.example`. Only the **publishable** key is used; never put the service-role key in the app.

## Deploying the app
Any Node host that runs Next.js 16 (Vercel Pro, Netlify, a container). Set the env vars, deploy `main`. Security headers incl. CSP are set in `next.config.ts`. Add an edge/WAF rate-limit rule for `POST /talk` and `POST /concern` (the in-app per-IP limiter is per instance only).

## Backups & restore
- Supabase Pro: daily backups, 7-day retention (dashboard → Database → Backups → Restore).
- **Additionally** (recommended, cheap): a weekly encrypted `pg_dump` kept outside Supabase, e.g.
  `pg_dump "$DB_URL" -Fc | gpg -c > nahal-$(date +%F).dump.gpg` on the org's secure storage.
- **Test a restore** into a scratch project once per quarter (regulation requirement for medium level).
- Admins can also export everything to Excel from the app (`/api/export`, logged).

## Changing the database
- Never edit an applied migration. Add `supabase/migrations/0005_<name>.sql`.
- Every new table: `enable row level security` + explicit policies + an audit trigger if it holds personal data.
- Add a test to `supabase/tests/db.test.ts` (the harness runs all migrations on a fresh Postgres in ~1s).

## Routine maintenance (2–4 hours / month)
| When | What |
|---|---|
| Monthly | `npm outdated`, update minor versions, run tests + build, deploy |
| Monthly | Supabase dashboard → Advisors (security + performance) |
| Quarterly | Restore test; review user list (Admin → משתמשים) and remove leavers; review audit log |
| Yearly | Review the database definition document & security procedure (regulations); re-check data minimisation |
| Immediately | Deactivate a user who leaves (Admin → משתמשים → השבתה) |

## Audit log retention
`audit_log` is append-only for the app (no UPDATE/DELETE grants). Keep ≥ 24 months. If it grows large, archive rows older than 24 months to a dump before deleting them via SQL as the database owner.

## Known limits of this version
- No live end-to-end test was run against a hosted Supabase project in this session (see `08-acceptance.md`).
- Outgoing WhatsApp/SMS is manual (wa.me links). E-mail alert for "I need to talk" requires `RESEND_API_KEY`.
- Merge is not undoable from the UI (the dropped record + a full snapshot are kept in the archive and audit log).

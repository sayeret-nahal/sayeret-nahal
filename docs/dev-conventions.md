# Development conventions (read before adding a module)

Stack: Next.js 16 App Router (dynamic rendering, no cacheComponents), React 19, TypeScript, Tailwind v4, Supabase (Postgres + Auth). Node is at `../.tools/node-v26.13.0-darwin-arm64/bin` — prefix commands with
`export PATH="$(cd .. && pwd)/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"`.
Next 16 differs from older versions: read `node_modules/next/dist/docs/` when unsure. `params`/`searchParams` are Promises. Middleware is `src/proxy.ts`.

## Security model
- **RLS is the real access control.** Every table has policies in `supabase/migrations/0002_security.sql`. The app uses only the publishable key and the user's session (`createClient()` from `@/lib/supabase/server`). Never use a service/secret key.
- Every staff page and every server action starts with `const { staff, userId } = await requireStaff()` (`@/lib/auth`).
- `perms` in `@/lib/permissions` mirrors RLS for the UI: hide controls a role can't use. Don't rely on it for security.
- Public (anon) features go only through the security-definer RPCs granted to anon in `0003_logic.sql`.
- Never store or ask for medical / psychological details. Free-text fields get a hint saying so.
- Log reads of personal records with `logAccess("view", table, id)` and exports with `logAccess("export", ...)` (`@/lib/data`).

## Data access
- Reference data: `const lookups = await getLookups()` → cohorts, regions, types, statuses, staff + helpers `cohortLabel`, `regionLabel`, `typeLabel`, `status(code)`, `staffName(id)`.
- Row types: `@/lib/types`. Labels for enums: `@/lib/labels`. Dates: `@/lib/dates` (`todayIL`, `formatDate`, `formatDateTime`, `relativeDay`, `daysFromToday`, `addDays`, `hebrewDate`, `memorialDates`). Phones: `@/lib/phone` (`normalizePhone`, `displayPhone`, `whatsappLink`).
- Schema: `supabase/migrations/0001_schema.sql`; RPCs: `0003_logic.sql`.

## Server actions
- Live in an `actions.ts` next to the page, `"use server"`.
- Form actions have the signature `(prev: ActionState, fd: FormData) => Promise<ActionState>` (`ActionState` from `@/components/ui/client`) and are used with `<ActionForm action={...}>`. Return `{ ok: true, message }` or `{ error, fieldErrors }` with Hebrew messages. Simple button actions may be `(fd: FormData) => Promise<void>`.
- Validate input (zod is available). Call `revalidatePath` for affected pages.

## UI
- Components: `@/components/ui` (server-safe: `Button`, `LinkButton`, `buttonClass`, `Card`, `CardHeader`, `PageHeader`, `Badge`, `Dot`, `EmptyState`, `Field`, `Input`, `Select`, `Textarea`, `Checkbox`, `Stat`, `Notice`, `DemoTag`, `cx`) and `@/components/ui/client` (`ActionForm`, `SubmitButton`, `Modal`, `ConfirmSubmit`, `CopyButton`). `AutoSubmitForm` for GET filter bars. Icons: `lucide-react` (no emoji as icons).
- Hebrew, RTL, gender-inclusive wording ("אחראי/ת"). Short, plain, action-oriented copy. Use logical properties (`ms-`, `ps-`, `start-`), never `left/right`.
- Every page: `export const metadata = { title: "…" }`, a `PageHeader`, empty states that say what to do, error messages in Hebrew.
- Mobile first: tables get a card/list fallback under `md`. Touch targets ≥ 36px.
- Accessibility: labels for every control (`Field` with `htmlFor`), `aria-current` in nav, `role="alert"` for errors, keyboard reachable, no color-only meaning.
- Demo records have `is_demo = true` → show `<DemoTag />` next to them.
- Reference implementation: `src/app/(app)/contacts/**` and `src/components/contacts/**`.

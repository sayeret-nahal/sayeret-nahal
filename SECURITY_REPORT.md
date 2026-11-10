# דוח אבטחה — מערכת ה-CRM של עמותת סיירת נח״ל

**תאריך:** 10 בנובמבר 2026
**היקף:** קוד הריפו `sayeret-nahal/sayeret-nahal`, הגדרות האתר (Next.js 16 ב-Vercel), מסד הנתונים (Supabase, סכמת `nahal`), החיבורים החיצוניים.
**שיטה:** מיפוי, בדיקה מול OWASP Top 10:2025 ורשימת הבדיקות שנמסרה, בדיקות במסד החי (קריאה בלבד), סריקת היסטוריית git, `npm audit`.

## 1. מיפוי

| רכיב | מה |
|---|---|
| אתר | Next.js 16.4 (App Router, `proxy.ts`), React 19, ב-Vercel |
| מסד נתונים והתחברות | Supabase: Postgres + Auth. מפתח ציבורי (publishable) בלבד; אין שימוש ב-service_role |
| שירותים חיצוניים | JGive, Grow (תשלומים), נקסוס (דוחות), 019 (וואטסאפ/SMS), Resend (מייל התראה, אופציונלי) |

**נקודות כניסה**
- **עמודים ציבוריים:** `/login`, `/talk`, `/concern`, `/contact`, `/embed/contact`, `/update/[token]`, `/auth/*`
- **API:** `/api/search`, `/api/export`, `/api/reports/impact`, `/api/admin/permissions` (מחייבים התחברות); `/api/public/inquiry` (ציבורי, CORS); `/api/hooks/[provider]` (מפתח ב-URL); `/api/cron/broadcasts` (Bearer)
- **Server actions:** 18 קבצים (`"use server"`), כולם קוראים ל-`requireStaff`/`adminSession` ונשענים על RLS
- **העלאת קבצים:** ייבוא אקסל/CSV (אנשים, תרומות, דוחות חיבורים) — בזיכרון בלבד, לא נשמר בדיסק

**איפה המידע:** כל המידע האישי בטבלאות Postgres עם RLS. **איפה הסודות:** משתני סביבה ב-Vercel; במסד נשמר רק hash של מפתח החיבורים.

## 2. מה נמצא תקין
- **סודות:** אין מפתחות, טוקנים או סיסמאות בקוד ובכל היסטוריית git — לא בריפו הנקי ולא בהיסטוריה המקורית (נסרקו תבניות של Supabase, GitHub, Stripe, Resend, AWS, JWT ומפתחות פרטיים). `.env*` ב-`.gitignore`; רק `.env.example` במעקב. **אין צורך להחליף מפתחות.**
- **משתני דפדפן:** רק `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_DB_SCHEMA` — כולם ציבוריים מטבעם.
- **RLS:** פעיל על **כל** הטבלאות בסכמה (נבדק במסד החי). לתפקיד anon אין שום הרשאה ישירה על טבלאות. כל ה-views עם `security_invoker`.
- **הרשאות:** כל route ו-server action בודקים התחברות והרשאה בשרת; ההרשאה האמיתית נאכפת ב-RLS (נבדקה ב-140+ בדיקות אוטומטיות, כולל IDOR בין תפקידים, מחזורים ומתנדבים).
- **קלט:** zod בכל טופס; כל פניות ה-DB דרך PostgREST/RPC עם פרמטרים — אין SQL שנבנה ממחרוזות. אין `dangerouslySetInnerHTML`/`innerHTML`.
- **סיסמאות:** מנוהלות ב-Supabase Auth (bcrypt). אורך מינימלי 12. הודעות שגיאה כלליות בכניסה, בהרשמה ובאיפוס (אין חשיפת קיום חשבון).
- **CSRF:** server actions של Next בודקים Origin; ה-API הציבורי לא משתמש בעוגיות; CORS עם רשימה מפורשת בלבד.
- **העלאות:** 5MB, xlsx/CSV בלבד, נקרא בזיכרון ונבדק בפענוח, לא נשמר.
- **שגיאות:** עמודי שגיאה כלליים; אין source maps בדפדפן; `X-Powered-By` כבוי.
- **Open redirect:** `safeNext` מאפשר רק נתיבים פנימיים.
- **קישורי עדכון עצמי:** נשמר רק hash של הטוקן, תוקף 30 יום, אפשר לבטל.

## 3. ממצאים

### קריטי

**C1 · מצב ההדגמה הציבורי נותן לכל מבקר הרשאות מנהל/ת מערכת אמיתיות**
- **איפה:** `src/app/(auth)/login/actions.ts:55-90` (`demoSignIn`), `supabase/seed/demo-accounts.sql`, משתנה `PUBLIC_DEMO=1` באתר החי.
- **ניצול:** כל מבקר לוחץ "מנהל/ת מערכת" ומקבל JWT של מנהל. העוגיות של Supabase קריאות ב-JavaScript, כך שאפשר לקחת את הטוקן ולפנות ישירות ל-API ולעקוף כל בדיקה בממשק. משם, באותו מסד שבו יש חשבון מנהל אמיתי (חזקי) והחיבורים החיים:
  1. ליצור הזמנה למייל של התוקף כ-admin (`staff_invites`) → להירשם → **חשבון מנהל אמיתי שנשאר גם אחרי כיבוי ההדגמה**;
  2. להשבית את החשבון של חזקי או לשנות לו תפקיד;
  3. לקרוא ב"ניהול ← חיבורים" את מפתח ה-webhook (`HOOK_KEY`) ולהזריק תשלומים/רכישות מזויפים;
  4. לקרוא ל-`set_ingest_secret` עם סוד משלו → לשבור את החיבורים, ולהשתמש בפונקציות ה-ingest ישירות;
  5. לכבות את חובת האימות הדו-שלבי, לייצא נתונים, ולאשר הודעות תפוצה (כשיחובר 019).
- **תיקון:**
  - **בקוד (בוצע):** חשבונות הדגמה לא רואים את מפתחות החיבורים ולא יכולים להפעיל פעולות ניהול רגישות בממשק.
  - **במסד (נכתב ונבדק — ממתין לאישורך להחלה על המסד החי):** `supabase/migrations/0010_demo_containment.sql`. מסמן `staff.is_demo` (נגזר תמיד מהמייל, אי אפשר לשנות), ומוסיף מדיניות RESTRICTIVE שחוסמת לחשבונות הדגמה: הזמנות ושינויי צוות, הגדרות, תבניות, נושאי פניות, מפתח החיבורים ואישור הודעות תפוצה. זה החלק שעוצר תוקף שפונה ישירות ל-API. 5 בדיקות חדשות ב-`supabase/tests/security.test.ts`.
  - **גם:** כתובת המייל של חזקי (מנהל אמיתי) גלויה לכל מבקר בהדגמה במסך המשתמשים.
  - **מיידי (דורש החלטה שלך):** להוציא את החשבון האמיתי של חזקי מסביבת ההדגמה, או לכבות את `PUBLIC_DEMO` עד שמיגרציה 0010 עולה. לעולם לא להכניס מידע אמיתי לסביבה עם `PUBLIC_DEMO`.

### גבוה

**H1 · ‏CSP מאפשר סקריפטים inline (`'unsafe-inline'`)**
- **איפה:** `next.config.ts` (script-src).
- **ניצול:** כל XSS שיימצא בעתיד ירוץ, ובגלל שעוגיות ההתחברות קריאות ב-JS (ראו M3) — גניבת חשבון.
- **תיקון (בוצע):** CSP עם nonce אקראי לכל בקשה ו-`'strict-dynamic'`, שנוצר ב-`src/proxy.ts`. `unsafe-inline` הוסר מ-script-src. נבדק בדפדפן: nonce אחד חדש לכל בקשה על כל 21 הסקריפטים בעמוד, כניסה, חיפוש וניווט עובדים בלי שגיאות. נוסף גם `upgrade-insecure-requests` (בבקשות HTTPS). (ב-style-src נשאר `'unsafe-inline'` בגלל `style=""` של React — סיכון נמוך בהרבה.)

**H2 · מנהלי מערכת בלי חובת אימות דו-שלבי באתר החי**
- **איפה:** ההגדרה `require_mfa=false` במסד (כובתה לטובת ההדגמה).
- **ניצול:** סיסמה שדלפה = גישה מלאה לכל המידע הרגיש.
- **תיקון:** הקוד כבר אוכף MFA גם ב-RLS כשההגדרה פעילה. **חובה להפעיל לפני הזנת מידע אמיתי** (ניהול ← הגדרות). לא שיניתי, כי זה ינעל את כניסת ההדגמה — דורש את החלטתך.

### בינוני

**M1 · אין הגבלת קצב על כניסה, הרשמה ואיפוס סיסמה ברמת האתר**
- **איפה:** `src/app/(auth)/login/actions.ts`.
- **ניצול:** ניחוש סיסמאות. כל הקריאות ל-Supabase יוצאות מהשרת, ולכן מגבלות ה-IP של Supabase חלות על השרת כולו ולא על התוקף.
- **תיקון (בוצע):** הגבלה לפי IP + לפי כתובת מייל בכל אחת מהפעולות, עם הודעה כללית. ההגבלה בזיכרון (לכל מופע) — לכן גם כלל WAF, ראו סעיף 5.

**M2 · אין הגנה מבוטים בטפסים הציבוריים**
- **איפה:** `/talk`, `/concern`, `/contact`, `/api/public/inquiry`.
- **ניצול:** הצפת פניות מזויפות. קיימות: honeypot, הגבלת קצב לפי IP וסימון ספאם במסד לפי טלפון.
- **תיקון (בוצע, כבוי עד שיוגדרו מפתחות):** תמיכה ב-Cloudflare Turnstile בכל הטפסים הציבוריים וב-API, עם אימות בשרת. נדלק כשמגדירים `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ו-`TURNSTILE_SECRET_KEY`.

**M3 · עוגיות ההתחברות של Supabase אינן HttpOnly**
- **איפה:** `@supabase/ssr` (הלקוח בדפדפן משמש למסכי MFA, איפוס סיסמה וניתוק בחוסר פעילות).
- **ניצול:** רק בשילוב עם XSS. **מיתון:** H1 (CSP עם nonce), Secure + SameSite=Lax, תוקף טוקן קצר.
- **המלצה:** בהמשך להעביר את שלושת המסכים לפעולות שרת ולהדליק HttpOnly. דורש שינוי בזרימת ההתחברות — לא בוצע בלי אישור.

**M4 · ה-webhooks של הספקים אינם חתומים**
- **איפה:** `src/app/api/hooks/[provider]/route.ts`.
- **ניצול:** מי שמשיג את כתובת ה-webhook (כולל המפתח) יכול לשלוח תשלומים מזויפים. JGive, Grow ו-019 לא מתעדים חתימה.
- **מיתון קיים:** מפתח אקראי ארוך בכתובת, השוואה ב-timing-safe, `webhookKey` של Grow, מניעת כפילויות, יומן מלא עם התוכן המקורי.
- **תיקון (בוצע):** הגבלת קצב גם על כתובות ה-webhook; ההמלצה: מפתח נפרד לכל ספק (`HOOK_KEY_JGIVE` וכו') וסיבוב אחרי כל חשד; לבקש מ-JGive ו-019 חתימה או רשימת IP.

**M5 · ה-sender של הודעות התפוצה בנה כתובת מכותרות הבקשה**
- **איפה:** `src/app/(app)/broadcasts/actions.ts` (`kickSender` → `getAppUrl`).
- **ניצול:** אם `NEXT_PUBLIC_APP_URL` לא מוגדר, `CRON_SECRET` נשלח לכתובת שנגזרה מ-Host. באתר החי המשתנה מוגדר, כך שלא נוצל.
- **תיקון (בוצע):** שימוש רק בכתובת מוגדרת בשרת (`NEXT_PUBLIC_APP_URL` או `VERCEL_PROJECT_PRODUCTION_URL`), אף פעם לא מכותרות.

**M6 · כלי הפיתוח של Vercel בתוך התלויות מביא חבילות פגיעות**
- **איפה:** `package.json` (devDependency `vercel`).
- **פירוט:** `npm audit` מצא 1 Critical (tar) ו-7 High (busboy, js-yaml, minimatch, path-to-regexp, smol-toml, zod ישן, ...) — כולם רק דרך `vercel`, ולא נכנסים לאתר. ב-production: רק `uuid` בתוך exceljs (Moderate; הפונקציה הפגיעה לא בשימוש).
- **תיקון (בוצע):** הוצאת `vercel` מהתלויות (מריצים עם `npx vercel@latest`). אחרי זה נשארות 2 Moderate בלבד.

### נמוך

- **L1 · HSTS בלי `preload`** — `next.config.ts`. **בוצע:** `max-age=63072000; includeSubDomains; preload`.
- **L2 · `Referrer-Policy: same-origin`** — מחמיר יותר מ-`strict-origin-when-cross-origin` שהתבקש; נשאר כך (לא מחלישים בקרה).
- **L3 · פונקציות עזר שאנונימי יכול להריץ** (`can_broadcast`, `can_send_broadcast`) — מחזירות false לאנונימי, אין דליפה. **תוקן במיגרציה 0010** (ממתין להחלה).
- **L4 · יומן החיבורים שומר את התוכן המקורי (כולל פרטים אישיים) ללא הגבלת זמן** — `integration_events.payload`. **תוקן במיגרציה 0010:** התוכן נמחק אוטומטית אחרי 12 חודשים (ממתין להחלה).
- **L5 · `/api/search` לא בודק MFA בשכבת האתר** — המסד אוכף זאת (RLS בודק aal2 כשהחובה פעילה). **בוצע:** בדיקה גם באתר.
- **L6 · ניתוק כל ההתחברויות בהחלפת סיסמה** — מוגדר ב-Supabase. להפעיל: Authentication ← Sessions/Security.

## 4. מצב
- **בוצע בקוד ונבדק:** C1 (שכבת האתר), H1, M1, M2, M4, M5, M6, L1, L5. 147 בדיקות אוטומטיות, typecheck, lint ו-build עוברים.
- **ממתין לאישור:** מיגרציה 0010 (C1 במסד, L3, L4) — החלה על המסד החי; פרסום הקוד לאתר; החלטה על `PUBLIC_DEMO` / החשבון של חזקי (C1); הפעלת MFA (H2).
- **לא נדחף לגיטהאב:** הריפו ציבורי, והדוח מתאר פרצה שעדיין פתוחה באתר החי. כדאי לדחוף רק אחרי שהיא נסגרת.
- **`npm audit` אחרי התיקון:** 9 Moderate בלבד — minimatch (בכלי ה-lint בלבד) ו-uuid בתוך exceljs (הפונקציה הפגיעה לא בשימוש). אין High/Critical.

## 5. הגדרות שצריך להפעיל ב-Vercel (Firewall)
ב-Vercel ← הפרויקט ← **Firewall**:
1. **Bot Protection / Attack Challenge Mode:** להשאיר זמין להפעלה בזמן מתקפה (Attack Challenge Mode).
2. **Custom Rules → Rate Limit** (Fixed Window, לפי IP):
   - `POST` ל-`/login` ול-`/auth/*`: 10 בקשות לדקה → Deny (429).
   - `POST` ל-`/talk`, `/concern`, `/contact`, `/embed/contact`, `/api/public/inquiry`: 5 לדקה → Challenge.
   - `/api/hooks/*`: 120 לדקה → Deny.
   - `/api/search`: 60 לדקה → Deny.
3. **Managed Rules:** להפעיל OWASP Core Ruleset (זמין בתוכנית Pro/Enterprise).
4. **Deployment Protection:** להשאיר את Vercel Authentication על כתובות התצוגה המקדימה (preview).
5. לשקול **IP Allowlist** ל-`/api/hooks/grow` אם Grow יספקו רשימת כתובות.

## 6. המלצות שוטפות
- להפעיל ב-GitHub: **Dependabot alerts + security updates** (Settings ← Code security), **Secret scanning + push protection**, ו-**branch protection** על `main`.
- להפעיל MFA בכל החשבונות: GitHub, Vercel, Supabase, 019, JGive, Grow.
- סביבת הייצור האמיתית: פרויקט Supabase נפרד, **בלי** `PUBLIC_DEMO`, עם `require_mfa=true`, גיבויים יומיים (Pro).

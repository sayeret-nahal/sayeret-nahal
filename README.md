# סיירת נחל · קשר עם הקהילה

מערכת CRM לעמותת סיירת נחל, לניהול הקשר עם לוחמי מילואים, יוצאי היחידה, פצועים, משפחות שכולות, תורמים ומתנדבים.

**גרסה 0.3 — מערכת הדגמה באוויר עם 3,000 אנשי דוגמה בדויים. עדיין לא הוזן בה מידע אמיתי.** מה בדיוק נבדק ומה עוד חסר: [docs/08-acceptance.md](docs/08-acceptance.md).

## מערכת הדגמה באוויר
**https://nahal-crm.vercel.app** — כניסה מהירה לפי תפקיד, בלי סיסמה. כל הנתונים בדויים.
- **אתר:** Vercel (פרויקט `nahal-crm`). שני משתנים מפעילים את מצב ההדגמה: `PUBLIC_DEMO=1` ו-`DEMO_PASSWORD`.
- **מסד נתונים:** Supabase. אפשר להתקין את המערכת בפרויקט ריק (סכמת `public`), או בסכמה נפרדת בתוך פרויקט קיים: `node scripts/schema-bundle.mjs nahal`, ואז `NEXT_PUBLIC_DB_SCHEMA=nahal`.
- **מערכת אמיתית:** בעתיד היא תעלה כפריסה נפרדת, בלי `PUBLIC_DEMO`, ועם מסד נתונים משלה.

## מסמכים
| מסמך | למי |
|---|---|
| [01 · מחקר ומסקנות](docs/01-research.md) | הנהלה |
| [02 · אפיון מוצר](docs/02-product-spec.md) | הנהלה, צוות |
| [03 · ארכיטקטורה ומודל נתונים](docs/03-architecture-data-model.md) | מפתח/ת |
| [04 · אבטחת מידע ופרטיות](docs/04-security-privacy.md) | הנהלה, יועץ/ת משפטי/ת |
| [05 · מדריך למשתמשים](docs/05-user-guide.md) | צוות |
| [06 · תוכנית השקה והטמעה](docs/06-launch-plan.md) | הנהלה |
| [07 · תיעוד טכני ותחזוקה](docs/07-technical.md) | מפתח/ת |
| [08 · בדיקות קבלה](docs/08-acceptance.md) | כולם |
| [09 · חיבורים: JGive, Grow, נקסוס, 019 ואתר](docs/09-integrations.md) | הנהלה, מפתח/ת |
| [מוסכמות פיתוח](docs/dev-conventions.md) | מפתח/ת |

## הרצה על המחשב (בלי ענן, בלי Docker)
```bash
npm install
npm run local          # מסד נתונים + API + התחברות + האתר, בכתובת http://localhost:3000
npm run local:fresh    # אותו דבר, אחרי מחיקת כל המידע המקומי (מתחיל מחדש עם נתוני דוגמה)
npm test               # כל הבדיקות
```
- **כניסה מהירה בלי משתמש:** במסך הכניסה בוחרים תפקיד ונכנסים בלחיצה. האפשרות קיימת רק בסביבה המקומית עם נתוני דוגמה. כשמחברים את המערכת ל-Supabase אמיתי היא נעלמת אוטומטית.
- בהפעלה הראשונה נוצרים מסד נתונים מקומי, 3,000 אנשי דוגמה וחשבון בדיקה אחד לכל תפקיד. הסיסמאות נשמרות בקובץ `.local/test-accounts.txt`, ששמור רק במחשב הזה.
- נדרשים Node.js וגם PostgREST: `brew install postgrest`, או הורדה מעמוד ה-releases של הפרויקט אל `../.tools/postgrest/postgrest`.
- המקומי משתמש באותן מיגרציות ובאותו קוד כמו Supabase, ולכן כל ההרשאות נבדקות בדיוק כמו בייצור.

## העלאה ל-Supabase
מריצים את `supabase/bundle/all-migrations.sql` בפרויקט חדש (הקובץ נוצר מחדש עם `npm run bundle`), ומגדירים שני ערכים: `NEXT_PUBLIC_SUPABASE_URL` ו-`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. פירוט מלא: [docs/07-technical.md](docs/07-technical.md).

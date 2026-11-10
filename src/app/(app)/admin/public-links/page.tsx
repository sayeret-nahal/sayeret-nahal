import type { Metadata } from "next";
import { ExternalLink, Globe, Mail, MessageCircle } from "lucide-react";
import { Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/ui/client";
import { requireAdmin } from "@/components/admin/guard";
import { getAppUrl } from "@/components/admin/app-url";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "קישורים ציבוריים" };

function LinkBox({ id, title, description, url }: { id: string; title: string; description: string; url: string }) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader id={id} title={title} subtitle={description} />
      <div className="px-5 pb-5 flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-muted-soft px-3 py-2 text-[13px] text-ink" dir="ltr">{url}</code>
        <CopyButton text={url} label="העתקת הקישור" />
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline h-8 px-1">
          <ExternalLink className="size-4" aria-hidden />פתיחה<span className="sr-only"> של {title} בחלון חדש</span>
        </a>
      </div>
    </Card>
  );
}

export default async function AdminPublicLinksPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [app, settings] = await Promise.all([
    getAppUrl(),
    supabase.from("settings").select("key,value").in("key", ["talk_response_hours", "concern_response_hours", "org_name"]),
  ]);
  const m = new Map((settings.data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const talkHours = Number(m.get("talk_response_hours") ?? 24) || 24;
  const concernHours = Number(m.get("concern_response_hours") ?? 48) || 48;
  const talkUrl = `${app.url}/talk`;
  const contactUrl = `${app.url}/contact`;
  const embedSnippet = `<!-- טופס פנייה לעמותה (מוטמע) — אפשר להוסיף ?topic=welfare / wounded / social ... -->
<iframe src="${app.url}/embed/contact" title="פנייה לעמותה" loading="lazy"
        style="width:100%;max-width:640px;height:900px;border:0;border-radius:16px"></iframe>`;
  const apiSnippet = `// למפתח/ת האתר — טופס משלכם:
// GET  ${app.url}/api/public/inquiry  → רשימת הנושאים
// POST ${app.url}/api/public/inquiry
fetch("${app.url}/api/public/inquiry", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ topic: "welfare", name, phone, email, message, consent: false, page: location.href }),
}).then((r) => r.json()); // { ok: true, ref } | { ok: false, error }`;
  const concernUrl = `${app.url}/concern`;

  const snippet = `<!-- כפתורי פנייה לעמותה -->
<div dir="rtl" style="display:flex;flex-wrap:wrap;gap:12px;font-family:inherit">
  <a href="${talkUrl}" target="_blank" rel="noopener"
     style="display:inline-block;padding:12px 22px;border-radius:10px;background:#425525;color:#fff;text-decoration:none;font-weight:600">
    אני צריך/ה לדבר
  </a>
  <a href="${concernUrl}" target="_blank" rel="noopener"
     style="display:inline-block;padding:12px 22px;border-radius:10px;border:1px solid #425525;color:#425525;text-decoration:none;font-weight:600">
    מודאג/ת לגבי חבר/ה?
  </a>
</div>`;

  const whatsappText = `צריכים לדבר? אנחנו כאן.\nאפשר להשאיר פרטים ונחזור אליכם בהקדם: ${talkUrl}\nמודאגים לגבי חבר? ספרו לנו בדיסקרטיות: ${concernUrl}\nבמצב חירום: מד"א 101, ער"ן 1201.`;
  const emailText = `צריך/ה לדבר? ${talkUrl} · מודאג/ת לגבי חבר/ה? ${concernUrl}`;

  return (
    <>
      <PageHeader
        title="קישורים ציבוריים"
        description="שני טפסים שכל אחד יכול למלא בלי להתחבר. כל פנייה נכנסת למערכת כפנייה חדשה עם מועד יעד."
        back={{ href: "/admin", label: "ניהול" }}
      />

      {!app.configured && (
        <div className="mb-5">
          <Notice tone="warn" title="הכתובת הקבועה של המערכת לא הוגדרה">
            הקישורים כאן מבוססים על הכתובת שממנה נכנסת עכשיו. לפני שמפרסמים, יש להגדיר את משתנה הסביבה NEXT_PUBLIC_APP_URL לכתובת הציבורית של המערכת.
          </Notice>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <LinkBox id="talk" title={'"אני צריך/ה לדבר"'} url={talkUrl}
            description={`לכל מי שרוצה שיחזרו אליו. נפתחת פנייה עם יעד תגובה של ${talkHours} שעות.`} />
          <LinkBox id="concern" title={'"מודאג/ת לגבי חבר/ה"'} url={concernUrl}
            description={`לדיווח בדיסקרטיות על חבר/ה שמדאיג/ה. נפתח דיווח חשש בעדיפות גבוהה, עם יעד תגובה של ${concernHours} שעות.`} />
        </div>

        <LinkBox id="contact" title="טופס פנייה כללי (לפי נושא)" url={contactUrl}
          description="רווחה, פצועים, רכז/ת חברתי/ת, תעסוקה ועוד — כל נושא מנותב לאחראי/ת שלו (ניהול ← ניתוב פניות מהאתר). אפשר לקשר לנושא מסוים: ?topic=welfare" />

        <Card aria-labelledby="embed">
          <CardHeader id="embed" title="הטמעת הטופס באתר העמותה" subtitle={'מדביקים ברכיב HTML באתר. כדי שהטמעה תעבוד, כתובת האתר צריכה להופיע במשתנה WEBSITE_ORIGINS בשרת.'}
            action={<CopyButton text={embedSnippet} label="העתקת הקוד" />} />
          <div className="px-5 pb-5 flex flex-col gap-3">
            <pre className="overflow-x-auto rounded-lg bg-ink text-white/90 p-4 text-[12px] leading-5" dir="ltr"><code>{embedSnippet}</code></pre>
            <details className="text-sm">
              <summary className="cursor-pointer text-brand">למפתח/ת האתר: חיבור לטופס קיים (API)</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-ink text-white/90 p-4 text-[12px] leading-5" dir="ltr"><code>{apiSnippet}</code></pre>
            </details>
          </div>
        </Card>

        <Card aria-labelledby="where">
          <CardHeader id="where" title="איפה כדאי לפרסם" subtitle="ככל שהקישור קל יותר למצוא, כך יותר אנשים יפנו בזמן." />
          <ul className="px-5 pb-5 grid gap-4 sm:grid-cols-3">
            <li className="flex gap-3">
              <Globe className="size-5 text-brand shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-medium text-sm">אתר העמותה</p>
                <p className="text-[13px] text-ink-2">כפתור בולט בראש העמוד או בתחתיתו, ובעמוד &quot;צור קשר&quot;. אפשר להעתיק את קוד הכפתורים שלמטה.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <MessageCircle className="size-5 text-brand shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-medium text-sm">קבוצות וואטסאפ</p>
                <p className="text-[13px] text-ink-2">בתיאור הקבוצה של כל מחזור, ובהודעה מוצמדת. כדאי לחזור על ההודעה לפני ימי זיכרון וחגים.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <Mail className="size-5 text-brand shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-medium text-sm">סוף כל מייל וניוזלטר</p>
                <p className="text-[13px] text-ink-2">שורה קבועה בחתימה של הצוות ובתחתית כל ניוזלטר, ליד פרטי ההתקשרות.</p>
              </div>
            </li>
          </ul>
        </Card>

        <Card aria-labelledby="snippet">
          <CardHeader id="snippet" title="קוד מוכן לאתר" subtitle="מעתיקים ומדביקים ברכיב HTML באתר (וויקס, וורדפרס וכדומה). הכפתורים נפתחים בחלון חדש."
            action={<CopyButton text={snippet} label="העתקת הקוד" />} />
          <div className="px-5 pb-5 flex flex-col gap-4">
            <div className="rounded-lg border border-dashed border-line-strong p-4">
              <p className="text-[12px] text-ink-3 mb-2">תצוגה מקדימה:</p>
              <div className="flex flex-wrap gap-3">
                <span className="inline-block rounded-[10px] bg-brand px-[22px] py-3 font-semibold text-white">אני צריך/ה לדבר</span>
                <span className="inline-block rounded-[10px] border border-brand px-[22px] py-3 font-semibold text-brand">מודאג/ת לגבי חבר/ה?</span>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-ink text-white/90 p-4 text-[12px] leading-5" dir="ltr"><code>{snippet}</code></pre>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card aria-labelledby="wa">
            <CardHeader id="wa" title="נוסח לוואטסאפ" action={<CopyButton text={whatsappText} label="העתקה" />} />
            <p className="px-5 pb-5 text-sm text-ink-2 whitespace-pre-line">{whatsappText}</p>
          </Card>
          <Card aria-labelledby="sig">
            <CardHeader id="sig" title="שורה לחתימת מייל" action={<CopyButton text={emailText} label="העתקה" />} />
            <p className="px-5 pb-5 text-sm text-ink-2 break-words">{emailText}</p>
          </Card>
        </div>

        <Notice tone="neutral">
          הטפסים מוגנים מפני הצפה: עד 3 פניות בשעה מאותו מספר טלפון. מי שממלא/ת טופס רואה את הודעת החירום ואת הודעת הפרטיות שמוגדרות בעמוד ההגדרות.
        </Notice>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, type Tone } from "@/components/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/ui/client";
import { ImportReportForm, TestSendForm } from "@/components/admin/integration-forms";
import { requireAdmin } from "@/components/admin/guard";
import { getAppUrl } from "@/components/admin/app-url";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDateTime, todayIL } from "@/lib/dates";
import { hookKeyFor, ingestClient, ingestSecret } from "@/lib/integrations/ingest";
import { smsConfigured, whatsappConfigured } from "@/lib/integrations/sms019";
import { syncIngestSecret } from "./actions";

export const metadata: Metadata = { title: "חיבורים" };

type Ev = { id: string; provider: string; kind: string; status: string; summary: string | null; error: string | null; contact_id: string | null; created_contact: boolean; received_at: string };

const PROVIDER_LABEL: Record<string, string> = { jgive: "JGive", grow: "Grow", nexus: "נקסוס", whatsapp: "019 · וואטסאפ/SMS", website: "אתר" };
const STATUS: Record<string, { label: string; tone: Tone }> = {
  processed: { label: "נקלט", tone: "ok" },
  duplicate: { label: "כפול (דולג)", tone: "neutral" },
  ignored: { label: "לא רלוונטי", tone: "neutral" },
  error: { label: "שגיאה", tone: "danger" },
};

export default async function IntegrationsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const app = await getAppUrl();
  const secret = ingestSecret();
  const [ping, events, stats] = await Promise.all([
    secret ? ingestClient().rpc("ingest_ping", { p_secret: secret }) : Promise.resolve({ data: false }),
    supabase.from("integration_events").select("id,provider,kind,status,summary,error,contact_id,created_contact,received_at").order("received_at", { ascending: false }).limit(60),
    supabase.from("integration_events").select("provider,status,received_at").gte("received_at", addDays(todayIL(), -30)).limit(20000),
  ]);
  const linked = ping.data === true;
  const evs = (events.data ?? []) as Ev[];
  const per = new Map<string, { ok: number; err: number; last?: string }>();
  for (const e of (stats.data ?? []) as { provider: string; status: string; received_at: string }[]) {
    const p = per.get(e.provider) ?? { ok: 0, err: 0 };
    if (e.status === "error") p.err++;
    else if (e.status === "processed") p.ok++;
    if (!p.last || e.received_at > p.last) p.last = e.received_at;
    per.set(e.provider, p);
  }
  const hook = (p: string) => {
    const k = hookKeyFor(p);
    return k ? `${app.url}/api/hooks/${p}?key=${k}` : null;
  };

  const cards = [
    { id: "jgive", title: "JGive — תרומות ודמי חבר", status: hook("jgive") && linked,
      text: "כל תשלום בקישור של JGive נקלט אוטומטית: האדם נרשם כחבר/ת עמותה ותורם/ת, והתשלום נרשם בתרומות. הוראות קבע והחזרים מטופלים.",
      setup: "ב-JGive: אזור הארגון ← הגדרות חשבון ← לשונית אינטגרציות ← Webhook URL ← להדביק את הכתובת ← שמירה.", url: hook("jgive") },
    { id: "grow", title: "Grow (משולם) — תשלומים", status: hook("grow") && linked,
      text: "כל תשלום בדפי התשלום ובקישורי Grow נקלט: חבר/ת עמותה + תשלום. גם חיובי הוראת קבע (מהחיוב השני ואילך) נקלטים.",
      setup: "פונים לתמיכה של Grow (support@grow.business) ומבקשים להפעיל Webhooks לכתובת הזו: לכל דפי התשלום והקישורים, וגם ל'תשלומים חוזרים'. את ה-webhookKey שהם נותנים שומרים בשרת (GROW_WEBHOOK_KEY).", url: hook("grow") },
    { id: "nexus", title: "נקסוס — מועדון צרכנות", status: linked,
      text: "רכישה דרך הקישור של העמותה נרשמת כשימוש בשירותי העמותה, והאדם נכנס לרשימה הורודה (אם אינו משלם פעיל).",
      setup: "לנקסוס אין ממשק ציבורי. מבקשים מהם דוח חודשי (אקסל) עם טלפון/דוא״ל לכל רכישה ומעלים אותו כאן — או, אם יסכימו, שישלחו כל רכישה לכתובת הזו.", url: hook("nexus") },
    { id: "019", title: "019 — הודעות תפוצה בוואטסאפ ו-SMS", status: (whatsappConfigured() || smsConfigured()) && linked,
      text: "שליחה בתבניות מאושרות, רק למי שהסכים/ה, עם הסרה אוטומטית כשמשיבים \"הסר\". סטטוס מסירה וקריאה מתעדכן.",
      setup: "ב-019: הגדרות ← ניהול Token API (טוקן), מספר וואטסאפ עסקי מאומת, ושם שולח ל-SMS. בהגדרות ה-Webhook של וואטסאפ ובכתובות ה-Push של SMS מדביקים את הכתובת הזו.", url: hook("019") },
  ];

  return (
    <>
      <PageHeader title="חיבורים" description="תשלומים, מועדון הצרכנות, הודעות תפוצה ופניות מהאתר." back={{ href: "/admin", label: "ניהול" }} />

      {!secret ? (
        <Notice tone="warn" title="החיבורים עוד לא הופעלו בשרת">צריך להגדיר בשרת את INGEST_SECRET ו-HOOK_KEY. הפרטים במסמך docs/09-integrations.md.</Notice>
      ) : !linked ? (
        <Notice tone="warn" title="צריך לסנכרן את מפתח החיבור">
          <span className="block mb-2">המפתח בשרת עוד לא נשמר במסד הנתונים, ולכן קריאות מבחוץ נדחות.</span>
          <ActionForm action={syncIngestSecret}><SubmitButton size="sm" pendingText="מסנכרן…">סנכרון המפתח</SubmitButton></ActionForm>
        </Notice>
      ) : (
        <Notice tone="ok" title="החיבורים פעילים">השרת והמסד מסונכרנים. כתובות החיבור למטה סודיות — לא לשתף מחוץ לעמותה.</Notice>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        {cards.map((c) => {
          const s = per.get(c.id === "019" ? "whatsapp" : c.id);
          return (
            <Card key={c.id} aria-labelledby={`int-${c.id}`}>
              <CardHeader id={`int-${c.id}`} title={c.title} action={c.status ? <Badge tone="ok">מחובר</Badge> : <Badge tone="warn">ממתין להגדרה</Badge>} />
              <div className="px-5 pb-5 flex flex-col gap-3 text-sm">
                <p className="text-ink-2">{c.text}</p>
                <p className="text-[13px] text-ink-3"><span className="font-medium text-ink-2">הגדרה: </span>{c.setup}</p>
                {c.url && (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-lg bg-muted-soft px-3 py-2 text-[12px]" dir="ltr">{c.url}</code>
                    <CopyButton text={c.url} label="העתקה" />
                  </div>
                )}
                <p className="text-[12px] text-ink-3">
                  30 ימים אחרונים: {s ? `${s.ok} נקלטו${s.err ? ` · ${s.err} שגיאות` : ""} · אחרון ${formatDateTime(s.last!)}` : "עוד לא התקבל כלום"}
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <Card aria-labelledby="int-import">
          <CardHeader id="int-import" title="ייבוא דוח" subtitle="לקליטת היסטוריה, או כשאין חיבור אוטומטי (נקסוס). תשלום שכבר נקלט לא ייקלט פעמיים." />
          <ImportReportForm />
        </Card>

        <Card aria-labelledby="int-test">
          <CardHeader id="int-test" title="בדיקת שליחה (019)" subtitle="שולח הודעה אחת למספר שתכתבו — לבדיקת החיבור." />
          <TestSendForm />
        </Card>
      </div>

      <Card className="mt-6" aria-labelledby="int-log">
        <CardHeader id="int-log" title="יומן אירועים" subtitle="60 האירועים האחרונים מכל החיבורים" action={<Link href="/admin/inquiry-topics" className="text-sm text-brand hover:underline">ניתוב פניות מהאתר</Link>} />
        {evs.length === 0 ? (
          <EmptyState title="עוד לא התקבלו אירועים">כשתשלום, רכישה או הודעה יגיעו — הם יופיעו כאן.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">יומן אירועים מהחיבורים</caption>
              <thead className="text-[12px] text-ink-3 border-y border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2 px-3 ps-5">מתי</th>
                  <th scope="col" className="text-start font-medium px-3">מקור</th>
                  <th scope="col" className="text-start font-medium px-3">מה</th>
                  <th scope="col" className="text-start font-medium px-3">מצב</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">אדם</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {evs.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 px-3 ps-5 text-ink-2 whitespace-nowrap">{formatDateTime(e.received_at)}</td>
                    <td className="px-3">{PROVIDER_LABEL[e.provider] ?? e.provider}</td>
                    <td className="px-3 text-ink-2">{e.summary ?? e.kind}{e.error && <div className="text-[12px] text-danger" dir="ltr">{e.error}</div>}</td>
                    <td className="px-3"><Badge tone={STATUS[e.status]?.tone ?? "neutral"}>{STATUS[e.status]?.label ?? e.status}</Badge></td>
                    <td className="px-3 pe-5">{e.contact_id ? <Link href={`/contacts/${e.contact_id}`} className="text-brand hover:underline">{e.created_contact ? "נוצר/ה" : "כרטיס"}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

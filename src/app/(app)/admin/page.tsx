import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, History, Link2, ListChecks, Plug, Route, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Badge, PageHeader, type Tone } from "@/components/ui";
import { requireAdmin } from "@/components/admin/guard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ניהול" };

interface Section { href: string; title: string; text: string; icon: LucideIcon; status?: { tone: Tone; text: string } }

export default async function AdminHubPage() {
  await requireAdmin();
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [staff, invites, mfa, demo] = await Promise.all([
    supabase.from("staff").select("id", head).eq("is_active", true),
    supabase.from("staff_invites").select("email", head),
    supabase.from("settings").select("value").eq("key", "require_mfa").maybeSingle<{ value: boolean }>(),
    supabase.from("contacts").select("id", head).eq("is_demo", true),
  ]);
  const pending = invites.count ?? 0;
  const demoCount = demo.count ?? 0;
  const mfaOn = mfa.data?.value !== false;

  const sections: Section[] = [
    {
      href: "/admin/users", title: "משתמשים והרשאות", icon: ShieldCheck,
      text: "הזמנת אנשי צוות, שינוי תפקיד ותחום, השבתת גישה ומטריצת ההרשאות.",
      status: staff.error ? undefined : { tone: pending ? "info" : "neutral", text: `${staff.count ?? 0} פעילים${pending ? ` · ${pending} הזמנות ממתינות` : ""}` },
    },
    {
      href: "/admin/settings", title: "הגדרות", icon: SlidersHorizontal,
      text: "זמני תגובה לפניות, טקסטים בטפסים הציבוריים, ניתוק אוטומטי ואימות דו-שלבי.",
      status: mfaOn ? { tone: "ok", text: "אימות דו-שלבי פעיל" } : { tone: "danger", text: "אימות דו-שלבי כבוי" },
    },
    {
      href: "/admin/lookups", title: "רשימות", icon: ListChecks,
      text: "מחזורים, אזורים, מצבי קשר וסוגי קשר — הערכים שמופיעים ברשימות הבחירה.",
    },
    {
      href: "/admin/audit", title: "יומן פעולות", icon: History,
      text: "מי ראה, שינה או ייצא מידע, ומתי. נשמר לפחות 24 חודשים.",
    },
    {
      href: "/admin/public-links", title: "קישורים ציבוריים", icon: Link2,
      text: "הקישורים לטפסים \"אני צריך/ה לדבר\" ו\"מודאג/ת לגבי חבר/ה\", וקוד מוכן לאתר.",
    },
    {
      href: "/admin/integrations", title: "חיבורים", icon: Plug,
      text: "JGive ו-Grow (חברי עמותה ותשלומים), נקסוס (שימוש בשירותים), 019 (וואטסאפ ו-SMS), ויומן אירועים.",
    },
    {
      href: "/admin/inquiry-topics", title: "ניתוב פניות מהאתר", icon: Route,
      text: "נושאי הפנייה בטופס באתר, ולמי כל נושא מגיע: רווחה, פצועים, רכז/ת חברתי/ת ועוד.",
    },
    {
      href: "/admin/demo", title: "נתוני דוגמה", icon: FlaskConical,
      text: "ספירה ומחיקה של רשומות הדוגמה לפני עבודה עם מידע אמיתי.",
      status: demo.error ? undefined : demoCount ? { tone: "warn", text: `${demoCount} אנשי דוגמה במערכת` } : { tone: "ok", text: "אין נתוני דוגמה" },
    },
  ];

  return (
    <>
      <PageHeader title="ניהול" description="הגדרות המערכת, הרשאות ואבטחת מידע. רק מנהלי מערכת רואים את העמודים האלה." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="group flex h-full flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-line-strong"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand-strong shrink-0">
                  <s.icon className="size-[18px]" aria-hidden strokeWidth={1.8} />
                </span>
                <span className="font-semibold text-ink group-hover:text-brand">{s.title}</span>
              </div>
              <p className="text-[13px] text-ink-2 flex-1">{s.text}</p>
              {s.status && <span><Badge tone={s.status.tone}>{s.status.text}</Badge></span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

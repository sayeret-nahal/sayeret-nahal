import Link from "next/link";
import { Badge, cx } from "@/components/ui";
import { ils } from "./format";

const TABS = [
  { href: "/donors", label: "תורמים" },
  { href: "/donors/donations", label: "תרומות" },
  { href: "/donors/campaigns", label: "קמפיינים" },
];

/** Sub-navigation for the donors area. */
export function DonorsTabs({ current }: { current: "/donors" | "/donors/donations" | "/donors/campaigns" }) {
  return (
    <nav aria-label="אזור התורמים" className="mb-6 border-b border-line">
      <ul className="flex gap-1 -mb-px overflow-x-auto">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.href === current ? "page" : undefined}
              className={cx(
                "inline-flex items-center h-10 px-3 text-sm border-b-2 whitespace-nowrap",
                t.href === current ? "border-brand text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink hover:border-line-strong",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Consent for donation / campaign messages by WhatsApp or SMS (Communications Law s.30A). */
export function ConsentBadge({ consent }: { consent: boolean | null }) {
  if (consent === true) return <Badge tone="ok">הסכים/ה לפניות</Badge>;
  if (consent === false) return <Badge tone="danger" title="לא לשלוח פניות לתרומה בוואטסאפ או SMS">לא לפנות בוואטסאפ/SMS</Badge>;
  return <Badge tone="warn" title="צריך הסכמה לפני פנייה לתרומה בוואטסאפ או SMS">צריך הסכמה לפני פנייה</Badge>;
}

/** Accessible progress bar toward a fundraising goal. */
export function GoalProgress({ raised, goal, label }: { raised: number; goal: number | null; label: string }) {
  if (!goal || goal <= 0) {
    return <p className="text-sm text-ink-2"><span className="font-semibold text-ink tabular-nums">{ils(raised)}</span> גויסו · ללא יעד מוגדר</p>;
  }
  const pct = Math.round((raised / goal) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm mb-1.5">
        <span><span className="font-semibold text-ink tabular-nums">{ils(raised)}</span> <span className="text-ink-3">מתוך {ils(goal)}</span></span>
        <span className={cx("tabular-nums font-medium", pct >= 100 ? "text-ok" : "text-ink-2")}>{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(raised, goal)}
        aria-valuetext={`${ils(raised)} מתוך ${ils(goal)} (${pct}%)`}
        className="h-2.5 w-full rounded-full bg-muted-soft overflow-hidden"
      >
        <div className={cx("h-full rounded-full", pct >= 100 ? "bg-ok" : "bg-brand")} style={{ width: `${Math.min(100, Math.max(pct, raised > 0 ? 2 : 0))}%` }} />
      </div>
    </div>
  );
}

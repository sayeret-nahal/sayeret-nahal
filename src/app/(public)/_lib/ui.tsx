import { Fragment, type ReactNode } from "react";
import { LifeBuoy, ShieldCheck } from "lucide-react";
import { cx } from "@/components/ui";

// Presentational pieces shared by the public (no-login) pages. No hooks, no server imports:
// safe to use from server and client components alike.

/** Used only if the settings could not be loaded: real Israeli emergency numbers. */
const FALLBACK_EMERGENCY = "אם יש סכנה מיידית לחיים — חייגו 101 (מד\"א) או 100 (משטרה). לתמיכה נפשית מיידית, 24/7: ער\"ן 1201.";

/** Turns short phone numbers (100, 101, 1201, *6444…) into tap-to-call links. */
function linkifyNumbers(text: string): ReactNode {
  const parts = text.split(/(\*?\d{3,5}(?![\d/]))/g);
  return parts.map((p, i) =>
    /^\*?\d{3,5}$/.test(p)
      ? <a key={i} href={`tel:${p}`} className="font-semibold underline underline-offset-2 whitespace-nowrap" dir="ltr">{p}</a>
      : <Fragment key={i}>{p}</Fragment>,
  );
}

export function EmergencyBox({ text, className }: { text?: string; className?: string }) {
  return (
    <aside aria-label="מצב חירום" className={cx("flex gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-ink", className)}>
      <LifeBuoy className="size-5 text-danger shrink-0 mt-0.5" aria-hidden />
      <p className="leading-relaxed">{linkifyNumbers(text || FALLBACK_EMERGENCY)}</p>
    </aside>
  );
}

export function PrivacyNote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="flex gap-2.5 rounded-lg bg-muted-soft px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
      <ShieldCheck className="size-4 shrink-0 mt-0.5 text-ink-3" aria-hidden />
      <p><span className="font-medium text-ink">פרטיות: </span>{text}</p>
    </div>
  );
}

/** Invisible field that people never fill. Bots that fill every field get silently ignored by the server. */
export function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -start-[10000px] top-auto size-px overflow-hidden">
      <label htmlFor="website">אתר אינטרנט (לא למילוי)</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}

export function PublicHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-ink leading-tight">{title}</h1>
      {children && <div className="text-[15px] text-ink-2 mt-2 leading-relaxed">{children}</div>}
    </header>
  );
}

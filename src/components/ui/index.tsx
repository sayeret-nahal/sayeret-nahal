import Link from "next/link";
import { clsx } from "clsx";
import { cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";

export { clsx as cx };

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md";

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none",
    size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-[13px]",
    variant === "primary" && "bg-brand text-white hover:bg-brand-strong",
    variant === "secondary" && "bg-surface text-ink border border-line-strong hover:bg-canvas",
    variant === "ghost" && "text-ink-2 hover:bg-muted-soft hover:text-ink",
    variant === "quiet" && "text-brand hover:bg-brand-soft",
    variant === "danger" && "bg-danger text-white hover:opacity-90",
    extra,
  );
}

export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={clsx("bg-surface border border-line rounded-[var(--radius-card)] shadow-[0_1px_2px_rgb(31_33_30/0.04)]", className)} {...props} />;
}

export function CardHeader({ title, action, subtitle, id }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode; id?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-[13px] text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6">
      {back && (
        <Link href={back.href} className="text-[13px] text-ink-3 hover:text-ink inline-flex items-center gap-1 mb-2">
          <span aria-hidden>→</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-extrabold text-ink">{title}</h1>
          {description && <p className="text-sm text-ink-2 mt-1 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export type Tone = "neutral" | "brand" | "danger" | "warn" | "info" | "ok" | "pink";

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap",
        tone === "neutral" && "bg-muted-soft text-ink-2",
        tone === "brand" && "bg-brand-soft text-brand-strong",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "info" && "bg-info-soft text-info",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "pink" && "bg-pink-soft text-pink",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block size-2 rounded-full shrink-0",
        tone === "danger" && "bg-danger",
        tone === "warn" && "bg-warn",
        tone === "info" && "bg-info",
        tone === "ok" && "bg-ok",
        tone === "brand" && "bg-brand",
        tone === "pink" && "bg-pink",
        tone === "neutral" && "bg-ink-3",
      )}
    />
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center px-6 py-10">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="text-sm text-ink-3 mt-1 max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, required, children, className }: {
  label: ReactNode; htmlFor: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="text-danger ms-0.5" aria-hidden>*</span> : <span className="text-ink-3 font-normal ms-1">(רשות)</span>}
      </label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            "aria-describedby": error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined,
            "aria-invalid": error ? true : undefined,
          })
        : children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-[12px] text-ink-3">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} className="text-[12px] text-danger" role="alert">{error}</p>}
    </div>
  );
}

const controlBase =
  "rounded-lg border border-control bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas";
// full width unless the caller sets a base width (clsx does not resolve conflicting utilities)
const control = (className?: string) => clsx(controlBase, !/(^|\s)w-/.test(className ?? "") && "w-full");

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(control(className), "h-10", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return <select className={clsx(control(className), "h-10 pe-8", className)} {...props}>{children}</select>;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(control(className), "py-2 min-h-24", className)} {...props} />;
}

export function Checkbox({ label, hint, ...props }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-sm cursor-pointer">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)] shrink-0" {...props} />
      <span>
        <span className="text-ink">{label}</span>
        {hint && <span className="block text-[12px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

export function Stat({ label, value, hint, href, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={clsx("text-2xl font-semibold mt-1 tabular-nums", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {hint && <div className="text-[12px] text-ink-3 mt-0.5">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block bg-surface border border-line rounded-[var(--radius-card)] px-4 py-3 hover:border-line-strong">{body}</Link>
  ) : (
    <div className="bg-surface border border-line rounded-[var(--radius-card)] px-4 py-3">{body}</div>
  );
}

export function DemoTag() {
  return <Badge tone="warn" title="רשומה לדוגמה — לא נתון אמיתי">דוגמה</Badge>;
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx(
        "rounded-lg px-4 py-3 text-sm border",
        tone === "info" && "bg-info-soft border-info/20 text-ink",
        tone === "warn" && "bg-warn-soft border-warn/20 text-ink",
        tone === "danger" && "bg-danger-soft border-danger/20 text-ink",
        tone === "ok" && "bg-ok-soft border-ok/20 text-ink",
        (tone === "neutral" || tone === "brand") && "bg-muted-soft border-line text-ink",
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={clsx(title && "mt-0.5", "text-ink-2")}>{children}</div>}
    </div>
  );
}

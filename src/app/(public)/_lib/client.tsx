"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { cx } from "@/components/ui";

/** Larger, 16px controls for the public forms (no iOS zoom, easy to tap). */
export const publicControl =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger";

export function PublicField({ id, label, optional, hint, error, children }: {
  id: string; label: ReactNode; optional?: boolean; hint?: ReactNode; error?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="text-ink-3 font-normal ms-1.5">(לא חובה)</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-[13px] text-ink-3">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-[13px] text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** a11y props linking a control to its hint / error. */
export function describe(id: string, error?: string, hasHint?: boolean) {
  return {
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  };
}

/** Confirmation screen; moves focus to its heading so screen readers announce it. */
export function Done({ title, children }: { title: string; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-8 text-center shadow-sm">
      <CheckCircle2 className="mx-auto size-12 text-ok" aria-hidden />
      <h2 ref={ref} tabIndex={-1} className="mt-3 text-xl font-semibold text-ink focus:outline-none">{title}</h2>
      <div className="mt-3 text-[15px] text-ink-2 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export function RefNumber({ value }: { value: number }) {
  return (
    <p className="inline-flex flex-col items-center rounded-xl bg-brand-soft px-5 py-3">
      <span className="text-[12px] text-ink-2">מספר הפנייה</span>
      <span className="text-2xl font-semibold text-brand-strong tabular-nums" dir="ltr">#{value}</span>
    </p>
  );
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return <p role="alert" className={cx("rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-ink")}>{error}</p>;
}

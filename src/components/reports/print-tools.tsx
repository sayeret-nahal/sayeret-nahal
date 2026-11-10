"use client";

import { useId, useState } from "react";
import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function PrintButton({ label = "הדפסה / שמירה כ-PDF" }: { label?: string }) {
  return (
    <button type="button" className={buttonClass("primary", "sm")} onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/**
 * Free-text context for the donor. Lives only in this browser tab: it is printed with the
 * report and is never sent to the server or stored.
 */
export function ContextNotes() {
  const id = useId();
  const [text, setText] = useState("");
  return (
    <>
      <div className="no-print flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          הערות להקשר <span className="text-ink-3 font-normal">(רשות)</span>
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          aria-describedby={`${id}-hint`}
          placeholder="לדוגמה: ברבעון הזה נפתח קו הטלפון החדש, ולכן מספר הפניות עלה."
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 min-h-24 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <p id={`${id}-hint`} className="text-[12px] text-ink-3">
          הטקסט יודפס עם הדוח ולא נשמר במערכת. כתבו הקשר כללי בלבד — בלי שמות, בלי פרטים מזהים ובלי סיפורים אישיים.
        </p>
      </div>
      {text.trim() && (
        <section className="hidden print:block mt-6 break-inside-avoid">
          <h2 className="text-[15px] font-semibold mb-1">הערות להקשר</h2>
          <p className="text-sm whitespace-pre-line">{text}</p>
        </section>
      )}
    </>
  );
}

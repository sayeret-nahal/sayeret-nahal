"use client";

import { buttonClass, cx } from "@/components/ui";
import { Turnstile } from "@/components/ui/turnstile";
import { useKeepValuesAction } from "@/components/cases/form";
import type { PublicFormState } from "../_lib/settings";
import { Honeypot, PrivacyNote } from "../_lib/ui";
import { Done, FormError, PublicField, RefNumber, describe, publicControl } from "../_lib/client";
import { submitInquiry } from "./actions";

export type Topic = { code: string; label: string; description: string | null };

export function InquiryForm({ topics, defaultTopic, privacyText, orgName, page }: {
  topics: Topic[]; defaultTopic?: string; privacyText?: string; orgName: string; page?: string;
}) {
  const [state, onSubmit, pending] = useKeepValuesAction<PublicFormState>(submitInquiry, {});
  const fe = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <Done title="הפנייה התקבלה. תודה!">
        {state.ref ? <RefNumber value={state.ref} /> : null}
        <p>הפנייה הועברה לאחראי/ת על התחום, ונחזור אליך בהקדם.</p>
      </Done>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-label="פנייה לעמותה">
      <Honeypot />
      {page && <input type="hidden" name="page" value={page} />}

      <PublicField id="inq-topic" label="במה מדובר?" error={fe.topic}>
        <select id="inq-topic" name="topic" required defaultValue={defaultTopic ?? ""} className={cx(publicControl, "h-12")} {...describe("inq-topic", fe.topic)}>
          <option value="" disabled>בחירת נושא…</option>
          {topics.map((t) => <option key={t.code} value={t.code}>{t.label}{t.description ? ` — ${t.description}` : ""}</option>)}
        </select>
      </PublicField>

      <PublicField id="inq-name" label="שם מלא" error={fe.name}>
        <input id="inq-name" name="name" autoComplete="name" maxLength={80} required className={cx(publicControl, "h-12")} {...describe("inq-name", fe.name)} />
      </PublicField>

      <div className="grid sm:grid-cols-2 gap-5">
        <PublicField id="inq-phone" label="טלפון" error={fe.phone}>
          <input id="inq-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required placeholder="05X-XXXXXXX"
            className={cx(publicControl, "h-12 text-end")} {...describe("inq-phone", fe.phone)} />
        </PublicField>
        <PublicField id="inq-email" label="דוא״ל" optional error={fe.email}>
          <input id="inq-email" name="email" type="email" autoComplete="email" dir="ltr" maxLength={120}
            className={cx(publicControl, "h-12 text-end")} {...describe("inq-email", fe.email, true)} />
        </PublicField>
      </div>

      <PublicField id="inq-message" label="במה נוכל לעזור?" error={fe.message} hint="בקצרה. אין צורך בפרטים רפואיים — נדבר על הכול בשיחה.">
        <textarea id="inq-message" name="message" rows={4} maxLength={2000} required className={cx(publicControl, "py-3 min-h-28")} {...describe("inq-message", fe.message, true)} />
      </PublicField>

      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
        <input type="checkbox" name="consent" className="mt-0.5 size-4 accent-[var(--color-brand)] shrink-0" />
        <span className="text-ink-2">
          אני מסכים/ה לקבל מ{orgName} עדכונים, הזמנות לאירועים ובקשות תרומה בוואטסאפ, ב-SMS ובדוא״ל. אפשר להסיר בכל עת בהשבת &quot;הסר&quot;.
          <span className="block text-[12px] text-ink-3">לא חובה — הפנייה תטופל גם בלי זה.</span>
        </span>
      </label>

      <Turnstile />
      <PrivacyNote text={privacyText} />
      <FormError error={state.error} />

      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "md", "h-12 text-base rounded-xl w-full")}>
        {pending ? "שולח…" : "שליחת הפנייה"}
      </button>
    </form>
  );
}

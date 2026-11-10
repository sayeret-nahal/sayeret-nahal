"use client";

import { buttonClass, cx } from "@/components/ui";
import { Turnstile } from "@/components/ui/turnstile";
import { useKeepValuesAction } from "@/components/cases/form";
import type { PublicFormState } from "../_lib/settings";
import { EmergencyBox, Honeypot, PrivacyNote } from "../_lib/ui";
import { Done, FormError, PublicField, RefNumber, describe, publicControl } from "../_lib/client";
import { submitConcern } from "./actions";

export function ConcernForm({ privacyText, emergencyText }: { privacyText?: string; emergencyText?: string }) {
  const [state, onSubmit, pending] = useKeepValuesAction<PublicFormState>(submitConcern, {});
  const fe = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <Done title="תודה שאכפת לך.">
        {state.ref ? <RefNumber value={state.ref} /> : null}
        <p>הדיווח הגיע לצוות העמותה ויקבל עדיפות גבוהה. ייתכן שנחזור אליך לשאול עוד משהו.</p>
        <p className="text-[13px] text-ink-3">אם המצב מחמיר לפני שחזרנו אליך — אל תחכו:</p>
        <EmergencyBox text={emergencyText} className="text-start" />
      </Done>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative flex flex-col gap-6 rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-label="דיווח על חבר">
      <Honeypot />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-base font-semibold text-ink mb-3">על מי מדובר?</legend>
        <PublicField id="c-friend-name" label="שם החבר/ה" error={fe.friend_name}>
          <input id="c-friend-name" name="friend_name" maxLength={80} required autoComplete="off" className={cx(publicControl, "h-12")} {...describe("c-friend-name", fe.friend_name)} />
        </PublicField>
        <PublicField id="c-friend-phone" label="הטלפון שלו/ה" optional error={fe.friend_phone} hint="אם יש לך. עוזר לנו לזהות אותו/ה.">
          <input id="c-friend-phone" name="friend_phone" type="tel" inputMode="tel" dir="ltr" autoComplete="off" placeholder="05X-XXXXXXX"
            className={cx(publicControl, "h-12 text-end")} {...describe("c-friend-phone", fe.friend_phone, true)} />
        </PublicField>
        <PublicField id="c-friend-cohort" label="מחזור / צוות" optional error={fe.friend_cohort} hint="למשל: נובמבר 2015, צוות של דני">
          <input id="c-friend-cohort" name="friend_cohort" maxLength={80} autoComplete="off" className={cx(publicControl, "h-12")} {...describe("c-friend-cohort", fe.friend_cohort, true)} />
        </PublicField>
        <PublicField id="c-message" label="מה מדאיג אותך?" optional error={fe.message}
          hint="כמה מילים מספיקות. לא צריך פרטים רפואיים או אבחנות — רק מה ששמת לב אליו.">
          <textarea id="c-message" name="message" rows={4} maxLength={2000} className={cx(publicControl, "py-3 min-h-28")} {...describe("c-message", fe.message, true)} />
        </PublicField>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
        <legend className="text-base font-semibold text-ink mb-3">
          ומי את/ה?
          <span className="block text-[13px] font-normal text-ink-3 mt-0.5">כדי שנוכל לחזור אליך אם צריך.</span>
        </legend>
        <PublicField id="c-reporter-name" label="השם שלך" error={fe.reporter_name}>
          <input id="c-reporter-name" name="reporter_name" maxLength={80} required autoComplete="name" className={cx(publicControl, "h-12")} {...describe("c-reporter-name", fe.reporter_name)} />
        </PublicField>
        <PublicField id="c-reporter-phone" label="הטלפון שלך" error={fe.reporter_phone}>
          <input id="c-reporter-phone" name="reporter_phone" type="tel" inputMode="tel" dir="ltr" required autoComplete="tel" placeholder="05X-XXXXXXX"
            className={cx(publicControl, "h-12 text-end")} {...describe("c-reporter-phone", fe.reporter_phone)} />
        </PublicField>
      </fieldset>

      <Turnstile />
      <PrivacyNote text={privacyText} />

      <FormError error={state.error} />

      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "md", "h-12 text-base rounded-xl w-full")}>
        {pending ? "שולח…" : "שליחת הדיווח"}
      </button>
    </form>
  );
}

"use client";

import { MessageCircle, MessageSquare, Phone } from "lucide-react";
import { buttonClass, cx } from "@/components/ui";
import { Turnstile } from "@/components/ui/turnstile";
import { useKeepValuesAction } from "@/components/cases/form";
import type { PublicFormState } from "../_lib/settings";
import { EmergencyBox, Honeypot, PrivacyNote } from "../_lib/ui";
import { Done, FormError, PublicField, RefNumber, describe, publicControl } from "../_lib/client";
import { submitTalk } from "./actions";

const CHANNELS = [
  { value: "phone", label: "שיחת טלפון", Icon: Phone },
  { value: "whatsapp", label: "וואטסאפ", Icon: MessageCircle },
  { value: "sms", label: "הודעת SMS", Icon: MessageSquare },
] as const;

export function TalkForm({ responseText, privacyText, emergencyText }: { responseText?: string; privacyText?: string; emergencyText?: string }) {
  const [state, onSubmit, pending] = useKeepValuesAction<PublicFormState>(submitTalk, {});
  const fe = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <Done title="קיבלנו. תודה שפנית.">
        {state.ref ? <RefNumber value={state.ref} /> : null}
        <p>{responseText ?? "מישהו מהעמותה יחזור אליך בהקדם."}</p>
        <p className="text-[13px] text-ink-3">אין צורך לעשות שום דבר נוסף. אם משהו משתנה בינתיים, אפשר לפנות שוב.</p>
        <EmergencyBox text={emergencyText} className="text-start mt-4" />
      </Done>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-label="בקשה לשיחה">
      <Honeypot />

      <PublicField id="talk-name" label="איך קוראים לך?" error={fe.name}>
        <input id="talk-name" name="name" autoComplete="name" maxLength={80} required className={cx(publicControl, "h-12")} {...describe("talk-name", fe.name)} />
      </PublicField>

      <PublicField id="talk-phone" label="טלפון" error={fe.phone}>
        <input id="talk-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required placeholder="05X-XXXXXXX"
          className={cx(publicControl, "h-12 text-end")} {...describe("talk-phone", fe.phone)} />
      </PublicField>

      <fieldset aria-describedby={fe.channel ? "talk-channel-error" : undefined}>
        <legend className="text-sm font-medium text-ink mb-2">איך נוח שנחזור אליך?</legend>
        <div className="grid grid-cols-3 gap-2">
          {CHANNELS.map(({ value, label, Icon }) => (
            <label key={value} className={cx(
              "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-3 text-sm text-center cursor-pointer min-h-[72px]",
              "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-strong has-[:checked]:font-medium",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40",
            )}>
              <input type="radio" name="channel" value={value} defaultChecked={value === "phone"} className="sr-only" />
              <Icon className="size-5" aria-hidden />
              {label}
            </label>
          ))}
        </div>
        {fe.channel && <p id="talk-channel-error" role="alert" className="text-[13px] text-danger mt-1.5">{fe.channel}</p>}
      </fieldset>

      <PublicField id="talk-time" label="מתי נוח לך?" optional error={fe.preferred_time} hint="למשל: אחרי 18:00, או בבוקר">
        <input id="talk-time" name="preferred_time" maxLength={200} className={cx(publicControl, "h-12")} {...describe("talk-time", fe.preferred_time, true)} />
      </PublicField>

      <PublicField id="talk-message" label="רוצה לספר במה מדובר?" optional error={fe.message}
        hint="לא חייבים להסביר. ואין צורך בפרטים רפואיים — נדבר על הכול בשיחה.">
        <textarea id="talk-message" name="message" rows={4} maxLength={2000} className={cx(publicControl, "py-3 min-h-28")} {...describe("talk-message", fe.message, true)} />
      </PublicField>

      <Turnstile />
      <PrivacyNote text={privacyText} />

      <FormError error={state.error} />

      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "md", "h-12 text-base rounded-xl w-full")}>
        {pending ? "שולח…" : "שליחה — שיחזרו אליי"}
      </button>
    </form>
  );
}

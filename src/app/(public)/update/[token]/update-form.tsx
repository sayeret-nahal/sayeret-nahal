"use client";

import type { ReactNode } from "react";
import { buttonClass, cx } from "@/components/ui";
import { useKeepValuesAction } from "@/components/cases/form";
import type { PublicFormState } from "../../_lib/settings";
import { PrivacyNote } from "../../_lib/ui";
import { Done, FormError, PublicField, describe, publicControl } from "../../_lib/client";
import { submitUpdate } from "./actions";

export interface UpdateProfile {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  city: string;
  region_id: number | null;
  profession: string;
  skills: string[];
  available_to_help: boolean;
  skills_share_consent: boolean;
  campaign_consent: boolean | null;
  regions: { id: number; label: string }[];
}

function Consent({ id, name, defaultChecked, label, hint }: { id: string; name: string; defaultChecked: boolean; label: ReactNode; hint: ReactNode }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-xl border border-line px-4 py-3 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60">
      <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} aria-describedby={`${id}-hint`}
        className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
      <span>
        <span className="block text-[15px] text-ink">{label}</span>
        <span id={`${id}-hint`} className="block text-[13px] text-ink-3 mt-0.5">{hint}</span>
      </span>
    </label>
  );
}

export function UpdateForm({ token, profile: p, privacyText }: { token: string; profile: UpdateProfile; privacyText?: string }) {
  const [state, onSubmit, pending] = useKeepValuesAction<PublicFormState>(submitUpdate, {});
  const fe = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <Done title="תודה! הפרטים עודכנו.">
        <p>זה עוזר לנו לשמור על קשר עם כל אחד ואחת בקהילה.</p>
        <p className="text-[13px] text-ink-3">שכחת משהו? אפשר לפתוח את הקישור שוב כל עוד הוא בתוקף.</p>
      </Done>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-label="עדכון פרטים">
      <input type="hidden" name="token" value={token} />

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm flex flex-col gap-4" aria-labelledby="u-personal">
        <h2 id="u-personal" className="text-base font-semibold text-ink">פרטים אישיים</h2>
        <div className="grid grid-cols-2 gap-3">
          <PublicField id="u-first" label="שם פרטי" error={fe.first_name}>
            <input id="u-first" name="first_name" defaultValue={p.first_name} required maxLength={60} autoComplete="given-name"
              className={cx(publicControl, "h-12")} {...describe("u-first", fe.first_name)} />
          </PublicField>
          <PublicField id="u-last" label="שם משפחה" error={fe.last_name}>
            <input id="u-last" name="last_name" defaultValue={p.last_name} maxLength={60} autoComplete="family-name"
              className={cx(publicControl, "h-12")} {...describe("u-last", fe.last_name)} />
          </PublicField>
        </div>
        <PublicField id="u-phone" label="טלפון נייד" error={fe.phone}>
          <input id="u-phone" name="phone" type="tel" inputMode="tel" dir="ltr" defaultValue={p.phone} autoComplete="tel"
            className={cx(publicControl, "h-12 text-end")} {...describe("u-phone", fe.phone)} />
        </PublicField>
        <PublicField id="u-email" label="דוא״ל" optional error={fe.email}>
          <input id="u-email" name="email" type="email" inputMode="email" dir="ltr" defaultValue={p.email} autoComplete="email"
            className={cx(publicControl, "h-12 text-end")} {...describe("u-email", fe.email)} />
        </PublicField>
        <div className="grid grid-cols-2 gap-3">
          <PublicField id="u-city" label="יישוב" optional error={fe.city}>
            <input id="u-city" name="city" defaultValue={p.city} maxLength={60} autoComplete="address-level2"
              className={cx(publicControl, "h-12")} {...describe("u-city", fe.city)} />
          </PublicField>
          {p.regions.length > 0 && (
            <PublicField id="u-region" label="אזור" optional error={fe.region_id}>
              <select id="u-region" name="region_id" defaultValue={p.region_id ?? ""} className={cx(publicControl, "h-12 pe-8")} {...describe("u-region", fe.region_id)}>
                <option value="">בחירה…</option>
                {p.regions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </PublicField>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm flex flex-col gap-4" aria-labelledby="u-work">
        <div>
          <h2 id="u-work" className="text-base font-semibold text-ink">מקצוע וכישורים</h2>
          <p className="text-[13px] text-ink-3 mt-0.5">בקהילה יש המון ידע. לפעמים חבר צריך בדיוק את מה שאת/ה יודע/ת.</p>
        </div>
        <PublicField id="u-prof" label="במה את/ה עוסק/ת?" optional error={fe.profession}>
          <input id="u-prof" name="profession" defaultValue={p.profession} maxLength={80} autoComplete="organization-title"
            className={cx(publicControl, "h-12")} {...describe("u-prof", fe.profession)} />
        </PublicField>
        <PublicField id="u-skills" label="כישורים ותחומי ידע" optional error={fe.skills} hint="מופרדים בפסיק. למשל: חשמלאי, ייעוץ משכנתאות, הובלות">
          <input id="u-skills" name="skills" defaultValue={p.skills.join(", ")} maxLength={900}
            className={cx(publicControl, "h-12")} {...describe("u-skills", fe.skills, true)} />
        </PublicField>
        <Consent id="u-help" name="available_to_help" defaultChecked={p.available_to_help}
          label="אשמח לעזור לחברים מהקהילה בתחום שלי"
          hint="למשל עצה מקצועית, עזרה בחיפוש עבודה או הכוונה. תמיד אפשר לסרב." />
        <Consent id="u-share" name="skills_share_consent" defaultChecked={p.skills_share_consent}
          label="העמותה רשאית להפנות אליי חברים שמחפשים עזרה בתחום שלי"
          hint="כלומר: לשתף איתם את המקצוע והכישורים שלי ודרך ליצור איתי קשר. אפשר לבטל בכל עת." />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm flex flex-col gap-4" aria-labelledby="u-msgs">
        <h2 id="u-msgs" className="text-base font-semibold text-ink">הודעות מהעמותה</h2>
        <Consent id="u-campaign" name="campaign_consent" defaultChecked={p.campaign_consent === true}
          label="אני מסכים/ה לקבל הודעות על תרומות וקמפיינים ב-SMS או בוואטסאפ"
          hint="לא חובה. הודעות שוטפות, כמו בקשה לעדכן פרטים, אינן תלויות בהסכמה הזאת. אפשר לבטל בכל עת." />
      </section>

      <PrivacyNote text={privacyText} />

      <FormError error={state.error} />

      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "md", "h-12 text-base rounded-xl w-full")}>
        {pending ? "שומר…" : "שמירה"}
      </button>
    </form>
  );
}

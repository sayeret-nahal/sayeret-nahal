"use client";

import { useState, type ReactNode } from "react";
import { Card, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { saveSettings } from "@/app/(app)/admin/settings/actions";

export interface SettingsValues {
  org_name: string;
  talk_response_hours: number;
  talk_response_text: string;
  concern_response_hours: number;
  request_sla_days: number;
  idle_timeout_minutes: number;
  stale_after_days: number;
  emergency_text: string;
  privacy_notice_text: string;
  privacy_notice_version: string;
  require_mfa: boolean;
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader id={id} title={title} subtitle={subtitle} />
      <div className="px-5 pb-5 flex flex-col gap-4">{children}</div>
    </Card>
  );
}

export function SettingsForm({ values }: { values: SettingsValues }) {
  const [mfa, setMfa] = useState(values.require_mfa);
  const turningOff = values.require_mfa && !mfa;

  return (
    <ActionForm action={saveSettings} className="flex flex-col gap-6">
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Section id="s-org" title="פרטי העמותה">
              <Field label="שם העמותה" htmlFor="org_name" required error={e.org_name} hint="מופיע בטפסים הציבוריים, בדוחות ובמסך הכניסה.">
                <Input id="org_name" name="org_name" defaultValue={values.org_name} required minLength={2} maxLength={80} />
              </Field>
            </Section>

            <Section id="s-sla" title="זמני תגובה לפניות" subtitle="קובעים את מועד היעד של כל פנייה חדשה. פניות קיימות שומרות על המועד שנקבע להן.">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="בקשת שיחה (שעות)" htmlFor="talk_response_hours" required error={e.talk_response_hours} hint={'פניות מהכפתור "אני צריך/ה לדבר". 1–168.'}>
                  <Input id="talk_response_hours" name="talk_response_hours" type="number" inputMode="numeric" min={1} max={168} step={1} defaultValue={values.talk_response_hours} required />
                </Field>
                <Field label="דיווח חשש (שעות)" htmlFor="concern_response_hours" required error={e.concern_response_hours} hint="דיווחים על חבר/ה שמדאיג/ה. 1–168.">
                  <Input id="concern_response_hours" name="concern_response_hours" type="number" inputMode="numeric" min={1} max={168} step={1} defaultValue={values.concern_response_hours} required />
                </Field>
                <Field label="פנייה רגילה (ימים)" htmlFor="request_sla_days" required error={e.request_sla_days} hint="כל שאר הפניות. 1–60.">
                  <Input id="request_sla_days" name="request_sla_days" type="number" inputMode="numeric" min={1} max={60} step={1} defaultValue={values.request_sla_days} required />
                </Field>
              </div>
              <Field label="הנוסח שמוצג אחרי בקשת שיחה" htmlFor="talk_response_text" required error={e.talk_response_text}
                hint="אם משנים את זמן התגובה לבקשת שיחה, עדכנו גם את הנוסח כך שההבטחה תתאים.">
                <Textarea id="talk_response_text" name="talk_response_text" defaultValue={values.talk_response_text} required minLength={10} maxLength={500} className="min-h-20" />
              </Field>
            </Section>

            <Section id="s-public" title="טקסטים בטפסים הציבוריים" subtitle="מוצגים לכל מי שפונה דרך האתר.">
              <Field label="הודעת חירום" htmlFor="emergency_text" required error={e.emergency_text} hint="מוצגת בראש הטפסים. כדאי לכלול מספרי חירום (101, 100, ער״ן 1201).">
                <Textarea id="emergency_text" name="emergency_text" defaultValue={values.emergency_text} required minLength={10} maxLength={600} className="min-h-20" />
              </Field>
              <Field label="הודעת פרטיות" htmlFor="privacy_notice_text" required error={e.privacy_notice_text}
                hint={<>גרסה נוכחית: <span dir="ltr">{values.privacy_notice_version || "—"}</span>. שינוי הנוסח יוצר גרסה חדשה אוטומטית, וכל מי שימסור פרטים מעכשיו יירשם עם הגרסה החדשה. כדאי לאשר את הנוסח מול יועץ/ת משפטי/ת.</>}>
                <Textarea id="privacy_notice_text" name="privacy_notice_text" defaultValue={values.privacy_notice_text} required minLength={20} maxLength={4000} className="min-h-32" />
              </Field>
            </Section>

            <Section id="s-security" title="אבטחה ואיכות נתונים">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ניתוק אחרי חוסר פעילות (דקות)" htmlFor="idle_timeout_minutes" required error={e.idle_timeout_minutes} hint="מגן על המידע כשמשאירים מחשב פתוח. 5–240.">
                  <Input id="idle_timeout_minutes" name="idle_timeout_minutes" type="number" inputMode="numeric" min={5} max={240} step={1} defaultValue={values.idle_timeout_minutes} required />
                </Field>
                <Field label="אימות פרטים מחדש אחרי (ימים)" htmlFor="stale_after_days" required error={e.stale_after_days} hint={'אחרי כמה זמן פרטי אדם נחשבים "לא מאומתים". 30–1825.'}>
                  <Input id="stale_after_days" name="stale_after_days" type="number" inputMode="numeric" min={30} max={1825} step={1} defaultValue={values.stale_after_days} required />
                </Field>
              </div>

              <div className="rounded-lg border border-line p-4 flex flex-col gap-3">
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <input type="checkbox" name="require_mfa" checked={mfa} onChange={(ev) => setMfa(ev.target.checked)}
                    className="mt-0.5 size-4 accent-[var(--color-brand)] shrink-0" aria-describedby="mfa-hint" />
                  <span>
                    <span className="text-ink font-medium">חובת אימות דו-שלבי לכל הצוות</span>
                    <span id="mfa-hint" className="block text-[12px] text-ink-3">
                      כל כניסה דורשת גם קוד מאפליקציית אימות בטלפון. המערכת מכילה מידע רגיש על אנשים — ההגדרה הזאת צריכה להישאר פעילה.
                    </span>
                  </span>
                </label>
                {turningOff && (
                  <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-sm flex flex-col gap-2">
                    <p className="font-semibold text-danger">ביטול האימות הדו-שלבי מסכן את המידע</p>
                    <p className="text-ink-2">
                      בלי אימות דו-שלבי, מי שישיג סיסמה של אחד מחברי הצוות יוכל לראות מידע רגיש על אנשים בקהילה.
                      תקנות אבטחת המידע מחייבות אמצעי זיהוי חזקים למאגר כזה. בטלו רק לצורך בדיקה, ולזמן קצר.
                    </p>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input type="checkbox" name="confirm_mfa_off" className="mt-0.5 size-4 accent-[var(--color-danger)] shrink-0" required
                        aria-invalid={!!e.confirm_mfa_off} />
                      <span className="text-ink">אני מבין/ה את הסיכון ומאשר/ת לבטל את חובת האימות הדו-שלבי</span>
                    </label>
                    {e.confirm_mfa_off && <p className="text-[12px] text-danger">{e.confirm_mfa_off}</p>}
                  </div>
                )}
              </div>
            </Section>

            <div className="sticky bottom-16 lg:bottom-0 z-10 -mx-4 lg:mx-0 px-4 lg:px-0 py-3 bg-canvas/95 backdrop-blur border-t border-line lg:border-0 flex items-center gap-3">
              <SubmitButton>שמירת ההגדרות</SubmitButton>
              <span className="text-[12px] text-ink-3">השינויים חלים מיד ונרשמים ביומן הפעולות.</span>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}

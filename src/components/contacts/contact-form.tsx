"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { saveContact } from "@/app/(app)/contacts/actions";
import { displayPhone } from "@/lib/phone";
import type { CareStatus, Contact, ContactType, Lookup, Staff } from "@/lib/types";

export function ContactForm({ contact, typeCodes = [], statusCode, lookups, canSeeCare, defaultName }: {
  contact?: Contact;
  typeCodes?: string[];
  statusCode?: string;
  lookups: { cohorts: Lookup[]; regions: Lookup[]; types: ContactType[]; statuses: CareStatus[]; staff: Staff[] };
  canSeeCare: boolean;
  defaultName?: string;
}) {
  const c = contact;
  const types = lookups.types.filter((t) => canSeeCare || !t.is_sensitive);
  return (
    <ActionForm action={saveContact} className="flex flex-col gap-5 max-w-3xl">
      {(state) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            {c && <input type="hidden" name="id" value={c.id} />}
            <Card>
              <CardHeader title="פרטים אישיים" />
              <div className="grid sm:grid-cols-2 gap-4 px-5 pb-5">
                <Field label="שם פרטי" htmlFor="first_name" required error={fe.first_name}>
                  <Input id="first_name" name="first_name" required maxLength={60} defaultValue={c?.first_name ?? defaultName?.split(" ")[0] ?? ""} autoFocus={!c} />
                </Field>
                <Field label="שם משפחה" htmlFor="last_name" error={fe.last_name}>
                  <Input id="last_name" name="last_name" maxLength={60} defaultValue={c?.last_name ?? defaultName?.split(" ").slice(1).join(" ") ?? ""} />
                </Field>
                <Field label="טלפון נייד" htmlFor="phone" error={fe.phone} hint="אפשר בכל פורמט, למשל 052-1234567">
                  <Input id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" className="text-end" defaultValue={displayPhone(c?.phone)} />
                </Field>
                <Field label="דוא״ל" htmlFor="email" error={fe.email}>
                  <Input id="email" name="email" type="email" dir="ltr" className="text-end" defaultValue={c?.email ?? ""} />
                </Field>
                <Field label="מחזור גיוס" htmlFor="cohort_id">
                  <Select id="cohort_id" name="cohort_id" defaultValue={c?.cohort_id ?? ""}>
                    <option value="">לא ידוע</option>
                    {lookups.cohorts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                </Field>
                <Field label="אזור מגורים" htmlFor="region_id">
                  <Select id="region_id" name="region_id" defaultValue={c?.region_id ?? ""}>
                    <option value="">לא ידוע</option>
                    {lookups.regions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                </Field>
                <Field label="יישוב" htmlFor="city">
                  <Input id="city" name="city" maxLength={60} defaultValue={c?.city ?? ""} />
                </Field>
                <Field label="תאריך לידה" htmlFor="birth_date" hint="רק אם האדם הסכים">
                  <Input id="birth_date" name="birth_date" type="date" defaultValue={c?.birth_date ?? ""} />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader title="הקשר עם העמותה" />
              <div className="px-5 pb-5 flex flex-col gap-4">
                <fieldset>
                  <legend className="text-[13px] font-medium mb-2">סוג קשר <span className="text-ink-3 font-normal">(אפשר לבחור כמה)</span></legend>
                  <div className="flex flex-wrap gap-2">
                    {types.map((t) => (
                      <label key={t.code} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 h-9 text-sm cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                        <input type="checkbox" name="types" value={t.code} defaultChecked={typeCodes.includes(t.code)} className="accent-[var(--color-brand)]" />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="אחראי/ת קשר" htmlFor="owner_id" hint="מי בעמותה שומר/ת על הקשר עם האדם">
                    <Select id="owner_id" name="owner_id" defaultValue={c?.owner_id ?? ""}>
                      <option value="">ללא אחראי</option>
                      {lookups.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </Select>
                  </Field>
                  {canSeeCare && !c && (
                    <Field label="מצב קשר" htmlFor="status_code">
                      <Select id="status_code" name="status_code" defaultValue={statusCode ?? "routine"}>
                        {lookups.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </Select>
                    </Field>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="כישורים ונכונות לעזור" subtitle="למאגר הכישורים. פרטים לא נחשפים לקהילה בלי הסכמה." />
              <div className="grid sm:grid-cols-2 gap-4 px-5 pb-5">
                <Field label="מקצוע" htmlFor="profession">
                  <Input id="profession" name="profession" maxLength={80} defaultValue={c?.profession ?? ""} />
                </Field>
                <Field label="כישורים ותחומי מומחיות" htmlFor="skills" hint="מופרדים בפסיקים, למשל: משפטים, הנדסת חשמל">
                  <Input id="skills" name="skills" defaultValue={c?.skills.join(", ") ?? ""} />
                </Field>
                <div className="sm:col-span-2 flex flex-col gap-2">
                  <Checkbox name="available_to_help" defaultChecked={c?.available_to_help} label="מוכן/ה לעזור לחברי הקהילה בתחום שלו/ה" />
                  <Checkbox name="skills_share_consent" defaultChecked={c?.skills_share_consent} label="הסכים/ה שנפנה אליו/ה אנשים שזקוקים לעזרה" />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="הסכמות והערות" />
              <div className="px-5 pb-5 flex flex-col gap-4">
                <Field label="הסכמה לקבל הודעות על קמפיינים ותרומות (SMS / וואטסאפ)" htmlFor="campaign_consent"
                  hint="הודעות תפעוליות (למשל אימות פרטים) לא דורשות הסכמה. פניות לתרומה כן.">
                  <Select id="campaign_consent" name="campaign_consent" defaultValue={c?.campaign_consent === true ? "yes" : c?.campaign_consent === false ? "no" : ""}>
                    <option value="">לא ידוע</option>
                    <option value="yes">הסכים/ה</option>
                    <option value="no">לא הסכים/ה</option>
                  </Select>
                </Field>
                <Field label="הערות כלליות" htmlFor="notes" error={fe.notes} hint="גלוי לכל מי שרואה את הכרטיס, כולל רכז/ת התורמים. אסור לרשום כאן מידע רפואי, נפשי או טיפולי — מה שקשור לליווי נרשם בתיעוד שיחה.">
                  <Textarea id="notes" name="notes" maxLength={2000} defaultValue={c?.notes ?? ""} />
                </Field>
                <Checkbox name="verified_now" label="אימתתי את הפרטים מול האדם עכשיו" hint="מסמן את הרשומה כמעודכנת להיום" />
                {fe.duplicate && <Checkbox name="confirm_duplicate" label="בדקתי — זה אדם אחר, לשמור בכל זאת" />}
              </div>
            </Card>

            <div className="flex gap-2">
              <SubmitButton>{c ? "שמירת שינויים" : "הוספה"}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}

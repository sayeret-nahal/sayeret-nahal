"use client";

import { useState } from "react";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { Card, CardHeader, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { CASE_SOURCE_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { createCase } from "@/app/(app)/cases/actions";
import { PersonPicker } from "./person-picker";
import { KeepForm, PendingButton } from "./form";

type Kind = "request" | "concern";
const SOURCES = ["staff", "phone", "whatsapp", "email", "other"] as const;
const PRIORITIES = ["normal", "high", "urgent"] as const;

export function NewCaseForm({ staff, currentUserId, contact, defaultKind, slaText, today }: {
  staff: { id: string; full_name: string }[];
  currentUserId: string;
  contact: { id: string; name: string } | null;
  defaultKind: Kind;
  slaText: { request: string; concern: string } | null;
  today: string;
}) {
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [priority, setPriority] = useState<string>(defaultKind === "concern" ? "high" : "normal");
  const [mode, setMode] = useState<"pick" | "free">("pick");
  const [picked, setPicked] = useState<boolean>(!!contact);

  function changeKind(k: Kind) {
    setKind(k);
    if (k === "concern" && priority === "normal") setPriority("high");
    if (k === "request" && priority === "high") setPriority("normal");
  }

  return (
    <KeepForm action={createCase} className="flex flex-col gap-5 max-w-3xl" ariaLabel="פנייה חדשה">
      {(state, pending) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            <Card>
              <CardHeader title="מה נפתח?" />
              <fieldset className="px-5 pb-5">
                <legend className="sr-only">סוג הפנייה</legend>
                <div className="grid sm:grid-cols-2 gap-3">
                  {([
                    { k: "request" as const, title: "פנייה", text: "מישהו פנה בעצמו ומבקש עזרה, שיחה או מידע.", Icon: MessageSquare },
                    { k: "concern" as const, title: "דיווח חשש", text: "חבר מהצוות או חבר אחר מודאג לגבי מישהו. מקבל עדיפות גבוהה.", Icon: AlertTriangle },
                  ]).map(({ k, title, text, Icon }) => (
                    <label key={k} className={cx(
                      "flex gap-3 rounded-xl border p-4 cursor-pointer transition-colors",
                      kind === k ? (k === "concern" ? "border-danger/40 bg-danger-soft" : "border-brand bg-brand-soft") : "border-line hover:border-line-strong",
                    )}>
                      <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => changeKind(k)} className="mt-1 accent-[var(--color-brand)]" />
                      <span>
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          <Icon className={cx("size-4", k === "concern" ? "text-danger" : "text-brand")} aria-hidden />{title}
                        </span>
                        <span className="block text-[13px] text-ink-2 mt-0.5">{text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>

            <Card>
              <CardHeader
                title={kind === "concern" ? "על מי מדובר?" : "מי פנה?"}
                subtitle={kind === "concern" ? "האדם שמדאיגים לגביו" : undefined}
              />
              <div className="px-5 pb-5 flex flex-col gap-4">
                {contact && picked ? (
                  <Field label="אדם מהמערכת" htmlFor="case-person" required error={fe.contact_id}>
                    <PersonPicker id="case-person" initial={contact} onChange={(p) => setPicked(!!p)} />
                  </Field>
                ) : (
                  <>
                    <div role="group" aria-label="איך לזהות את האדם" className="inline-flex self-start rounded-lg border border-line p-0.5 bg-canvas">
                      {([["pick", "בחירה מהמערכת"], ["free", "לא נמצא במערכת"]] as const).map(([m, label]) => (
                        <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                          className={cx("h-9 px-3 rounded-md text-sm", mode === m ? "bg-surface shadow-sm font-medium text-ink" : "text-ink-2 hover:text-ink")}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {mode === "pick" ? (
                      <Field label="חיפוש אדם" htmlFor="case-person" required error={fe.contact_id ?? fe.person_name}
                        hint="הקלידו לפחות שתי אותיות. לא מוצאים? עברו ל&quot;לא נמצא במערכת&quot;.">
                        <PersonPicker id="case-person" invalid={!!(fe.contact_id ?? fe.person_name)} />
                      </Field>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="שם" htmlFor="person_name" required error={fe.person_name}>
                          <Input id="person_name" name="person_name" maxLength={80} autoComplete="off" aria-invalid={!!fe.person_name || undefined} />
                        </Field>
                        <Field label="טלפון" htmlFor="person_phone" error={fe.person_phone} hint="לדוגמה 052-1234567">
                          <Input id="person_phone" name="person_phone" type="tel" inputMode="tel" dir="ltr" className="text-end" autoComplete="off" aria-invalid={!!fe.person_phone || undefined} />
                        </Field>
                        <p className="sm:col-span-2 text-[12px] text-ink-3">אחרי הפתיחה אפשר לקשר את הפנייה לכרטיס קיים או ליצור כרטיס חדש.</p>
                      </div>
                    )}
                  </>
                )}

                {kind === "concern" && (
                  <div className="grid sm:grid-cols-2 gap-4 border-t border-line pt-4">
                    <Field label="מי דיווח/ה" htmlFor="reporter_name" error={fe.reporter_name} hint="מי שסיפר/ה לנו על החשש">
                      <Input id="reporter_name" name="reporter_name" maxLength={80} autoComplete="off" />
                    </Field>
                    <Field label="טלפון של המדווח/ת" htmlFor="reporter_phone" error={fe.reporter_phone}>
                      <Input id="reporter_phone" name="reporter_phone" type="tel" inputMode="tel" dir="ltr" className="text-end" autoComplete="off" />
                    </Field>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="במה מדובר?" />
              <div className="px-5 pb-5 grid sm:grid-cols-2 gap-4">
                <Field label="נושא" htmlFor="category">
                  <Select id="category" name="category" defaultValue={kind === "concern" ? "concern" : ""} key={kind}>
                    <option value="">בחירה…</option>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="איך הגיעה הפנייה" htmlFor="source" required>
                  <Select id="source" name="source" defaultValue="staff">
                    {SOURCES.map((s) => <option key={s} value={s}>{CASE_SOURCE_LABELS[s]}</option>)}
                  </Select>
                </Field>
                <Field label="תיאור קצר" htmlFor="message" required error={fe.message} className="sm:col-span-2"
                  hint="מה צריך ומה כבר ידוע. בלי פרטים רפואיים או נפשיים: רק מה שהצוות צריך כדי לעזור.">
                  <Textarea id="message" name="message" required minLength={3} maxLength={4000} rows={4} aria-invalid={!!fe.message || undefined} />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader title="טיפול" />
              <div className="px-5 pb-5 grid sm:grid-cols-3 gap-4">
                <Field label="עדיפות" htmlFor="priority" required error={fe.priority}>
                  <Select id="priority" name="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </Select>
                </Field>
                <Field label="אחראי/ת" htmlFor="assignee_id" error={fe.assignee_id}>
                  <Select id="assignee_id" name="assignee_id" defaultValue={currentUserId}>
                    <option value="">ללא אחראי (לשיבוץ מאוחר)</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.id === currentUserId ? `${s.full_name} (אני)` : s.full_name}</option>)}
                  </Select>
                </Field>
                <Field label="לטפל עד" htmlFor="due_date" error={fe.due_date}
                  hint={slaText ? `אם לא תבחרו: ${kind === "concern" ? slaText.concern : slaText.request}` : "אם לא תבחרו, המועד ייקבע אוטומטית לפי הגדרות המערכת"}>
                  <Input id="due_date" name="due_date" type="date" min={today} />
                </Field>
              </div>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
              <PendingButton pending={pending} pendingText="פותח…">{kind === "concern" ? "פתיחת דיווח חשש" : "פתיחת פנייה"}</PendingButton>
              {kind === "concern" && <p className="text-[13px] text-ink-3">דיווח חשש מקבל עדיפות גבוהה לפחות.</p>}
            </div>
          </>
        );
      }}
    </KeepForm>
  );
}

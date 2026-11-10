"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, PhoneCall } from "lucide-react";
import { Modal } from "@/components/ui/client";
import { Button, Checkbox, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { TaskForm } from "@/components/contacts/task-form";
import { CASE_STATUS_LABELS } from "@/lib/labels";
import {
  addCaseNote, assignCase, createContactFromCase, linkCaseToContact, reopenCase, resolveCase, setCaseStatus,
} from "@/app/(app)/cases/actions";
import { KeepForm, PendingButton } from "./form";
import { PersonPicker } from "./person-picker";

type StaffOption = { id: string; full_name: string };

/** Add a note or log a phone call to the case's activity log. */
export function AddNoteForm({ caseId }: { caseId: string }) {
  const [kind, setKind] = useState<"note" | "call">("note");
  return (
    <KeepForm action={addCaseNote} resetOnSuccess className="flex flex-col gap-3" ariaLabel="תיעוד בפנייה">
      {(state, pending) => (
        <>
          <input type="hidden" name="case_id" value={caseId} />
          <fieldset>
            <legend className="sr-only">מה מתעדים</legend>
            <div className="inline-flex rounded-lg border border-line p-0.5 bg-canvas">
              {([["note", "הערה", MessageSquareText], ["call", "שיחה שהתקיימה", PhoneCall]] as const).map(([k, label, Icon]) => (
                <label key={k} className={cx(
                  "inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40",
                  kind === k ? "bg-surface shadow-sm font-medium text-ink" : "text-ink-2 hover:text-ink",
                )}>
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  <Icon className="size-4" aria-hidden />{label}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={kind === "call" ? "מה עלה בשיחה" : "הערה"} htmlFor={`note-${caseId}`} required error={state.fieldErrors?.body}
            hint="מה עשינו, מה סוכם ומה הצעד הבא. בלי פרטים רפואיים או נפשיים.">
            <Textarea id={`note-${caseId}`} name="body" rows={3} maxLength={4000} required aria-invalid={!!state.fieldErrors?.body || undefined} />
          </Field>
          <div><PendingButton pending={pending} size="sm">{kind === "call" ? "שמירת השיחה" : "שמירת ההערה"}</PendingButton></div>
        </>
      )}
    </KeepForm>
  );
}

export function AssignForm({ caseId, assigneeId, staff, currentUserId }: { caseId: string; assigneeId: string | null; staff: StaffOption[]; currentUserId: string }) {
  const known = !assigneeId || staff.some((s) => s.id === assigneeId);
  return (
    <KeepForm action={assignCase} ariaLabel="אחראי/ת לפנייה">
      {(_, pending) => (
        <>
          <input type="hidden" name="case_id" value={caseId} />
          <label htmlFor={`assignee-${caseId}`} className="text-[13px] font-medium text-ink">אחראי/ת</label>
          <div className="flex gap-2 mt-1.5">
            <Select id={`assignee-${caseId}`} name="assignee_id" defaultValue={assigneeId ?? ""} className="flex-1 min-w-0">
              <option value="">ללא אחראי</option>
              {!known && <option value={assigneeId!}>איש/אשת צוות שאינו/ה פעיל/ה</option>}
              {staff.map((s) => <option key={s.id} value={s.id}>{s.id === currentUserId ? `${s.full_name} (אני)` : s.full_name}</option>)}
            </Select>
            <PendingButton pending={pending} variant="secondary" pendingText="…">שמירה</PendingButton>
          </div>
        </>
      )}
    </KeepForm>
  );
}

export function StatusForm({ caseId, status }: { caseId: string; status: "new" | "in_progress" | "waiting" }) {
  return (
    <KeepForm action={setCaseStatus} ariaLabel="סטטוס הפנייה">
      {(_, pending) => (
        <>
          <input type="hidden" name="case_id" value={caseId} />
          <label htmlFor={`status-${caseId}`} className="text-[13px] font-medium text-ink">סטטוס</label>
          <div className="flex gap-2 mt-1.5">
            <Select id={`status-${caseId}`} name="status" defaultValue={status} className="flex-1 min-w-0">
              {(["new", "in_progress", "waiting"] as const).map((s) => <option key={s} value={s}>{CASE_STATUS_LABELS[s]}</option>)}
            </Select>
            <PendingButton pending={pending} variant="secondary" pendingText="…">שמירה</PendingButton>
          </div>
        </>
      )}
    </KeepForm>
  );
}

export function ResolveForm({ caseId, hasActivity }: { caseId: string; hasActivity: boolean }) {
  return (
    <KeepForm action={resolveCase} className="flex flex-col gap-3" ariaLabel="סגירת הפנייה">
      {(state, pending) => (
        <>
          <input type="hidden" name="case_id" value={caseId} />
          <Field label="מה נעשה?" htmlFor={`resolution-${caseId}`} required error={state.fieldErrors?.resolution}
            hint="חובה לפני סגירה: מה עשינו ומה התוצאה. למשל: ״דיברנו, חיברנו אותו לרכז התעסוקה, הוא יחזור אלינו אם צריך״.">
            <Textarea id={`resolution-${caseId}`} name="resolution" rows={3} minLength={3} maxLength={4000} required
              aria-invalid={!!state.fieldErrors?.resolution || undefined} />
          </Field>
          {!hasActivity && (
            <p className="text-[12px] text-warn">עדיין לא תועדו כאן הערה או שיחה. אם דיברתם עם האדם, כדאי לתעד את זה קודם.</p>
          )}
          <div><PendingButton pending={pending} pendingText="סוגר…">סגירת הפנייה</PendingButton></div>
        </>
      )}
    </KeepForm>
  );
}

export function ReopenForm({ caseId }: { caseId: string }) {
  return (
    <KeepForm action={reopenCase} ariaLabel="פתיחה מחדש">
      {(_, pending) => (
        <>
          <input type="hidden" name="case_id" value={caseId} />
          <PendingButton pending={pending} variant="secondary" size="sm" pendingText="פותח…">פתיחה מחדש</PendingButton>
        </>
      )}
    </KeepForm>
  );
}

/** Link the case to an existing person card. */
export function LinkContactForm({ caseId }: { caseId: string }) {
  return (
    <KeepForm action={linkCaseToContact} className="flex flex-col gap-2" ariaLabel="קישור לכרטיס אדם">
      {(state, pending) => (
        <>
          <input type="hidden" name="case_id" value={caseId} />
          <Field label="קישור לאדם שכבר במערכת" htmlFor={`link-${caseId}`} required error={state.fieldErrors?.contact_id}>
            <PersonPicker id={`link-${caseId}`} invalid={!!state.fieldErrors?.contact_id} />
          </Field>
          <div><PendingButton pending={pending} variant="secondary" size="sm" pendingText="מקשר…">קישור</PendingButton></div>
        </>
      )}
    </KeepForm>
  );
}

/** "Create a new person from this request" (prefilled, editable). */
export function CreateContactButton({ caseId, defaults }: { caseId: string; defaults: { first_name: string; last_name: string; phone: string } }) {
  return (
    <Modal trigger="יצירת כרטיס אדם חדש מהפנייה" title="כרטיס אדם חדש" triggerVariant="ghost" triggerSize="sm">
      {(close) => <CreateContactPanel caseId={caseId} defaults={defaults} onDone={close} />}
    </Modal>
  );
}

function CreateContactPanel({ caseId, defaults, onDone }: { caseId: string; defaults: { first_name: string; last_name: string; phone: string }; onDone: () => void }) {
  const router = useRouter();
  const [linking, startLink] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);

  function linkExisting(contactId: string) {
    setLinkError(null);
    startLink(async () => {
      const fd = new FormData();
      fd.set("case_id", caseId);
      fd.set("contact_id", contactId);
      const r = await linkCaseToContact({}, fd);
      if (r.ok) { onDone(); router.refresh(); } else setLinkError(r.error ?? "הקישור נכשל");
    });
  }

  return (
    <KeepForm action={createContactFromCase} onSuccess={() => { onDone(); router.refresh(); }} className="flex flex-col gap-4" ariaLabel="כרטיס אדם חדש">
      {(state, pending) => {
        const fe = state.fieldErrors ?? {};
        const dups = (fe.duplicate ?? "").split(",").filter(Boolean).map((x) => { const [id, ...n] = x.split("|"); return { id, name: n.join("|") }; });
        return (
          <>
            <p className="text-sm text-ink-2">הפרטים מולאו מהפנייה. אפשר לתקן לפני השמירה, ולהשלים את השאר בכרטיס עצמו.</p>
            <input type="hidden" name="case_id" value={caseId} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="שם פרטי" htmlFor="cc-first" required error={fe.first_name}>
                <Input id="cc-first" name="first_name" defaultValue={defaults.first_name} required maxLength={60} />
              </Field>
              <Field label="שם משפחה" htmlFor="cc-last" error={fe.last_name}>
                <Input id="cc-last" name="last_name" defaultValue={defaults.last_name} maxLength={60} />
              </Field>
            </div>
            <Field label="טלפון" htmlFor="cc-phone" error={fe.phone}>
              <Input id="cc-phone" name="phone" type="tel" inputMode="tel" dir="ltr" className="text-end" defaultValue={defaults.phone} />
            </Field>
            {dups.length > 0 && (
              <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm flex flex-col gap-2">
                <p className="text-ink">אולי זה אחד מהם?</p>
                <div className="flex flex-wrap gap-2">
                  {dups.map((d) => (
                    <Button key={d.id} size="sm" disabled={linking} onClick={() => linkExisting(d.id)}>קישור ל{d.name}</Button>
                  ))}
                </div>
                {linkError && <p role="alert" className="text-danger text-[13px]">{linkError}</p>}
                <Checkbox name="confirm_new" label="זה אדם אחר, ליצור כרטיס חדש בכל זאת" />
              </div>
            )}
            <div><PendingButton pending={pending} pendingText="יוצר…">יצירה וקישור לפנייה</PendingButton></div>
          </>
        );
      }}
    </KeepForm>
  );
}

/** Task linked to the case (and to the person, when known). */
export function CaseTaskButton({ caseId, contactId, staff, currentUserId }: { caseId: string; contactId: string | null; staff: StaffOption[]; currentUserId: string }) {
  const router = useRouter();
  return (
    <Modal trigger="משימה חדשה" title="משימה בפנייה" triggerVariant="quiet" triggerSize="sm">
      {(close) => (
        <TaskForm caseId={caseId} contactId={contactId ?? undefined} staff={staff} currentUserId={currentUserId}
          onDone={() => { close(); router.refresh(); }} />
      )}
    </Modal>
  );
}

/** The public form matched the phone to a person: staff confirm before linking (never automatic). */
export function SuggestedContactLink({ caseId, contactId, name }: { caseId: string; contactId: string; name: string }) {
  return (
    <KeepForm action={linkCaseToContact} className="rounded-lg bg-info-soft px-3 py-2.5 text-sm" ariaLabel="אישור קישור מוצע">
      {(state, pending) => (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input type="hidden" name="case_id" value={caseId} />
          <input type="hidden" name="contact_id" value={contactId} />
          <span>מספר הטלפון תואם לכרטיס של <strong>{name}</strong>. זה האדם?</span>
          <PendingButton pending={pending} size="sm" variant="secondary" pendingText="מקשר…">כן, לקשר</PendingButton>
          {state.error && <span role="alert" className="text-danger w-full">{state.error}</span>}
        </div>
      )}
    </KeepForm>
  );
}

"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field, Select, Textarea, Input } from "@/components/ui";
import { KIND_LABELS, OUTCOME_LABELS } from "@/lib/labels";
import { todayIL } from "@/lib/dates";
import { logInteraction } from "@/app/(app)/contacts/actions";

const KINDS = ["call", "message", "meeting", "attempt", "event", "note"] as const;
const OUTCOMES = ["talked", "no_answer", "rescheduled", "needs_followup", "no_contact_requested"] as const;

export function LogInteractionForm({ contactId, onDone, context = "community", defaultKind = "call" }: {
  contactId: string; onDone?: () => void; context?: "community" | "donor"; defaultKind?: (typeof KINDS)[number];
}) {
  const [kind, setKind] = useState<string>(defaultKind);
  const [outcome, setOutcome] = useState<string>("");
  const needsNext = outcome === "rescheduled" || outcome === "no_contact_requested";
  const today = todayIL();
  const uid = contactId.slice(0, 6);
  return (
    <ActionForm action={logInteraction} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      <input type="hidden" name="contact_id" value={contactId} />
      <input type="hidden" name="context" value={context} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="סוג" htmlFor={`kind-${uid}`} required>
          <Select id={`kind-${uid}`} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="מתי" htmlFor={`occ-${uid}`} required>
          <Input id={`occ-${uid}`} name="occurred_on" type="date" defaultValue={today} max={today} />
        </Field>
      </div>
      {(kind === "call" || kind === "attempt" || kind === "message") && (
        <fieldset>
          <legend className="text-[13px] font-medium mb-1.5">מה קרה? {kind === "call" && <span className="text-danger" aria-hidden>*</span>}</legend>
          <div className="grid gap-1.5">
            {OUTCOMES.map((o) => (
              <label key={o} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${outcome === o ? "border-brand bg-brand-soft" : "border-line"}`}>
                <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} required={kind === "call"} className="accent-[var(--color-brand)]" />
                {OUTCOME_LABELS[o]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="סיכום קצר" htmlFor={`sum-${uid}`} hint="מה חשוב שהצוות ידע? בלי פרטים רפואיים או נפשיים.">
        <Textarea id={`sum-${uid}`} name="summary" maxLength={2000} rows={3} />
      </Field>
      {outcome === "needs_followup" && <p className="text-[13px] text-ink-2 -mt-2">תיווצר לך משימה להמשך טיפול בעוד 3 ימים.</p>}
      <Field label={needsNext ? "מתי לחזור אליו/ה" : "שיחה הבאה"} htmlFor={`next-${uid}`} required={outcome === "no_contact_requested"}
        hint={needsNext ? undefined : "אם לא תבחרו, המערכת תקבע לפי תדירות הקשר שהוגדרה"}>
        <Input id={`next-${uid}`} name="next_date" type="date" min={today} required={outcome === "no_contact_requested"} />
      </Field>
      <SubmitButton>שמירת התיעוד</SubmitButton>
    </ActionForm>
  );
}

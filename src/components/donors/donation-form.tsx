"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { PersonPicker } from "@/components/calendar/person-picker";
import { addDonation } from "@/app/(app)/donors/actions";
import { METHODS } from "./format";

export function DonationForm({ campaigns, today, defaultCampaign, onDone }: {
  campaigns: { id: number; name: string }[]; today: string; defaultCampaign?: number; onDone?: () => void;
}) {
  const [recurring, setRecurring] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  if (done) {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <CheckCircle2 className="size-8 text-ok" aria-hidden />
        <p role="status" className="text-sm text-ink">{done}</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => { setDone(null); setRecurring(false); setRound((r) => r + 1); }}>רישום תרומה נוספת</Button>
          {onDone && <Button onClick={onDone}>סגירה</Button>}
        </div>
      </div>
    );
  }

  return (
    <ActionForm key={round} action={addDonation} onSuccess={(s) => setDone(s.message ?? "התרומה נרשמה")} className="flex flex-col gap-4">
      {(state) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            <Field label="תורם/ת" htmlFor="don-person" required error={fe.contact_id}
              hint="אם האדם עוד לא מסומן/ת כתורם/ת, הסימון יתווסף אוטומטית.">
              <PersonPicker id="don-person" name="contact_id" required invalid={!!fe.contact_id} describedBy={fe.contact_id ? "don-person-error" : "don-person-hint"} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="סכום (₪)" htmlFor="don-amount" required error={fe.amount}>
                <Input id="don-amount" name="amount" inputMode="decimal" required dir="ltr" className="text-end" placeholder="0" autoComplete="off"
                  pattern="[0-9][0-9,]*(\.[0-9]{1,2})?" title="סכום במספרים, למשל 1,250 או 180.50"
                  aria-invalid={!!fe.amount || undefined} aria-describedby={fe.amount ? "don-amount-error" : undefined} />
              </Field>
              <Field label="תאריך התרומה" htmlFor="don-date" required error={fe.donated_at}>
                <Input id="don-date" name="donated_at" type="date" required max={today} defaultValue={today}
                  aria-invalid={!!fe.donated_at || undefined} aria-describedby={fe.donated_at ? "don-date-error" : undefined} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="אמצעי תשלום" htmlFor="don-method">
                <Select id="don-method" name="method" defaultValue="" onChange={(e) => { if (e.target.value === "הוראת קבע") setRecurring(true); }}>
                  <option value="">לא צוין</option>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
              <Field label="קמפיין" htmlFor="don-campaign">
                <Select id="don-campaign" name="campaign_id" defaultValue={defaultCampaign ?? ""}>
                  <option value="">ללא קמפיין</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <Checkbox name="is_recurring" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} label="תרומה קבועה (הוראת קבע)" />
            <Field label="אסמכתה" htmlFor="don-ref" error={fe.external_ref} hint="מספר קבלה או מספר עסקה. מונע רישום כפול, גם בייבוא.">
              <Input id="don-ref" name="external_ref" maxLength={100} dir="ltr" className="text-end" autoComplete="off" />
            </Field>
            <Field label="הערות" htmlFor="don-notes" error={fe.notes} hint="לשימוש פנימי. בלי פרטי אשראי או חשבון בנק.">
              <Textarea id="don-notes" name="notes" maxLength={1000} className="min-h-16" />
            </Field>
            <SubmitButton>רישום התרומה</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}

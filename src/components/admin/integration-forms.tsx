"use client";

import { Field, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { importReport, testSend } from "@/app/(app)/admin/integrations/actions";

export function ImportReportForm() {
  return (
    <ActionForm action={importReport} className="px-5 pb-5 flex flex-col gap-3" resetOnSuccess>
      {(st) => (
        <>
          <Field label="מקור" htmlFor="imp-provider" required>
            <Select id="imp-provider" name="provider" required defaultValue="">
              <option value="" disabled>בחירה…</option>
              <option value="jgive">JGive — ייצוא תרומות (Donations ← Download)</option>
              <option value="grow">Grow — דוח עסקאות</option>
              <option value="nexus">נקסוס — דוח רכישות</option>
            </Select>
          </Field>
          <Field label="קובץ (xlsx או CSV)" htmlFor="imp-file" required hint="חייבות להיות עמודות של מספר עסקה/הזמנה, וטלפון או דוא״ל.">
            <input id="imp-file" name="file" type="file" required accept=".xlsx,.csv,.tsv,.txt" className="text-sm" />
          </Field>
          {st.message && <p role="status" className="text-sm text-ok">{st.message}</p>}
          <SubmitButton pendingText="קולט…">ייבוא</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function TestSendForm() {
  return (
    <ActionForm action={testSend} className="px-5 pb-5 flex flex-col gap-3" closeOnSuccess={false}>
      {(st) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ערוץ" htmlFor="t-channel"><Select id="t-channel" name="channel"><option value="whatsapp">וואטסאפ</option><option value="sms">SMS</option></Select></Field>
            <Field label="הטלפון שלך" htmlFor="t-phone"><Input id="t-phone" name="phone" type="tel" dir="ltr" required /></Field>
          </div>
          <Field label="מזהה תבנית ב-019 (לוואטסאפ)" htmlFor="t-template"><Input id="t-template" name="template" dir="ltr" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dry" className="accent-[var(--color-brand)]" /> בדיקה יבשה ל-SMS (בלי לשלוח בפועל)</label>
          {st.message && <p role="status" className="text-sm text-ok">{st.message}</p>}
          <SubmitButton pendingText="שולח…" variant="secondary">שליחת בדיקה</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field, Input, Select } from "@/components/ui";
import { updateCare } from "@/app/(app)/contacts/actions";
import type { CareStatus, ContactCare, Staff } from "@/lib/types";

export function CareForm({ contactId, care, ownerId, statuses, staff, canEditOwner, onDone }: {
  contactId: string; care: ContactCare; ownerId: string | null; statuses: CareStatus[]; staff: Staff[]; canEditOwner: boolean; onDone?: () => void;
}) {
  return (
    <ActionForm action={updateCare} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      <input type="hidden" name="contact_id" value={contactId} />
      <Field label="מצב קשר" htmlFor="care-status" required hint="שינוי למצב דחוף יותר מקדים את השיחה הבאה אוטומטית">
        <Select id="care-status" name="status_code" defaultValue={care.status_code}>
          {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}{s.cadence_days ? ` · כל ${s.cadence_days} ימים` : ""}</option>)}
        </Select>
      </Field>
      {canEditOwner && (
        <Field label="אחראי/ת קשר" htmlFor="care-owner">
          <Select id="care-owner" name="owner_id" defaultValue={ownerId ?? ""}>
            <option value="">ללא אחראי</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="תדירות מותאמת (ימים)" htmlFor="care-cadence" hint="ריק = לפי המצב">
          <Input id="care-cadence" name="cadence_days" type="number" min={1} max={730} defaultValue={care.cadence_days ?? ""} />
        </Field>
        <Field label="השיחה הבאה" htmlFor="care-next">
          <Input id="care-next" name="next_contact_at" type="date" defaultValue={care.next_contact_at ?? ""} />
        </Field>
      </div>
      <SubmitButton>שמירה</SubmitButton>
    </ActionForm>
  );
}

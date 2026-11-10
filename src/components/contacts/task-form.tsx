"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import { addTask } from "@/app/(app)/contacts/actions";

export function TaskForm({ contactId, caseId, staff, currentUserId, onDone }: {
  contactId?: string; caseId?: string; staff: { id: string; full_name: string }[]; currentUserId: string; onDone?: () => void;
}) {
  return (
    <ActionForm action={addTask} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      {contactId && <input type="hidden" name="contact_id" value={contactId} />}
      {caseId && <input type="hidden" name="case_id" value={caseId} />}
      <Field label="מה צריך לעשות" htmlFor="task-title" required>
        <Input id="task-title" name="title" required maxLength={200} placeholder="לדוגמה: לברר לגבי הטופס לביטוח לאומי" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="עד מתי" htmlFor="task-due">
          <Input id="task-due" name="due_date" type="date" />
        </Field>
        <Field label="מי אחראי/ת" htmlFor="task-assignee" required>
          <Select id="task-assignee" name="assignee_id" defaultValue={currentUserId}>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.id === currentUserId ? `${s.full_name} (אני)` : s.full_name}</option>)}
          </Select>
        </Field>
      </div>
      <Checkbox name="priority" value="high" label="חשוב / דחוף" />
      <SubmitButton>הוספת משימה</SubmitButton>
    </ActionForm>
  );
}

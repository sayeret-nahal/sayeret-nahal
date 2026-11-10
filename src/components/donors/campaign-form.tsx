"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field, Input, Textarea } from "@/components/ui";
import { saveCampaign } from "@/app/(app)/donors/actions";
import type { Campaign } from "@/lib/types";

export function CampaignForm({ campaign, onDone }: { campaign?: Campaign; onDone?: () => void }) {
  const p = campaign ? `camp-${campaign.id}` : "camp-new";
  return (
    <ActionForm action={saveCampaign} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      {(state) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            {campaign && <input type="hidden" name="id" value={campaign.id} />}
            <Field label="שם הקמפיין" htmlFor={`${p}-name`} required error={fe.name}>
              <Input id={`${p}-name`} name="name" required maxLength={100} defaultValue={campaign?.name ?? ""} placeholder="לדוגמה: מלגות לוחמים 2027" />
            </Field>
            <Field label="יעד (₪)" htmlFor={`${p}-goal`} error={fe.goal_amount} hint="אפשר להשאיר ריק אם אין יעד כספי">
              <Input id={`${p}-goal`} name="goal_amount" inputMode="decimal" dir="ltr" className="text-end" autoComplete="off"
                pattern="[0-9][0-9,]*(\.[0-9]{1,2})?" title="סכום במספרים, למשל 50,000"
                defaultValue={campaign?.goal_amount != null ? String(Number(campaign.goal_amount)) : ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך התחלה" htmlFor={`${p}-start`} error={fe.starts_on}>
                <Input id={`${p}-start`} name="starts_on" type="date" defaultValue={campaign?.starts_on ?? ""} />
              </Field>
              <Field label="תאריך סיום" htmlFor={`${p}-end`} error={fe.ends_on}>
                <Input id={`${p}-end`} name="ends_on" type="date" defaultValue={campaign?.ends_on ?? ""} />
              </Field>
            </div>
            <Field label="תיאור" htmlFor={`${p}-desc`} error={fe.description}>
              <Textarea id={`${p}-desc`} name="description" maxLength={1000} defaultValue={campaign?.description ?? ""} placeholder="למה מגייסים, למי מיועד" />
            </Field>
            <SubmitButton>{campaign ? "שמירת שינויים" : "הוספת קמפיין"}</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}

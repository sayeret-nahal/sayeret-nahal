"use client";

import { useId } from "react";
import { Pencil } from "lucide-react";
import { Field, Input } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Modal, SubmitButton } from "@/components/ui/client";
import { inviteStaff, setStaffActive, updateStaff } from "@/app/(app)/admin/users/actions";
import type { Lookup, Staff } from "@/lib/types";
import { RoleFields } from "./role-fields";

export function InviteForm({ cohorts, regions }: { cohorts: Lookup[]; regions: Lookup[] }) {
  const id = useId();
  return (
    <ActionForm action={inviteStaff} resetOnSuccess className="flex flex-col gap-4">
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="שם מלא" htmlFor={`${id}-name`} required error={state.fieldErrors?.full_name}>
              <Input id={`${id}-name`} name="full_name" required minLength={2} maxLength={80} autoComplete="off" />
            </Field>
            <Field label="דוא״ל" htmlFor={`${id}-email`} required error={state.fieldErrors?.email}
              hint="הכתובת שאיתה הוא/היא יירשמו. רק כתובת שהוזמנה יכולה להירשם.">
              <Input id={`${id}-email`} name="email" type="email" required dir="ltr" autoComplete="off" className="text-start" />
            </Field>
          </div>
          <RoleFields cohorts={cohorts} regions={regions} errors={state.fieldErrors} />
          <div><SubmitButton pendingText="שומר…">שמירת ההזמנה</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function EditStaffButton({ member, cohorts, regions, isSelf }: { member: Staff; cohorts: Lookup[]; regions: Lookup[]; isSelf: boolean }) {
  const id = useId();
  return (
    <Modal
      title={`עריכת ${member.full_name}`}
      trigger={<><Pencil className="size-3.5" aria-hidden />עריכה<span className="sr-only"> של {member.full_name}</span></>}
      triggerVariant="ghost"
      triggerSize="sm"
    >
      {() => (
        <ActionForm action={updateStaff} className="flex flex-col gap-4">
          {(state) => (
            <>
              <input type="hidden" name="id" value={member.id} />
              <p className="text-[13px] text-ink-3" dir="ltr">{member.email}</p>
              <Field label="שם מלא" htmlFor={`${id}-name`} required error={state.fieldErrors?.full_name}>
                <Input id={`${id}-name`} name="full_name" defaultValue={member.full_name} required minLength={2} maxLength={80} />
              </Field>
              <RoleFields defaultRole={member.role} cohorts={cohorts} regions={regions}
                cohortScope={member.cohort_scope} regionScope={member.region_scope} errors={state.fieldErrors} />
              {isSelf && (
                <p className="text-[12px] text-warn">זה החשבון שלך. אם תשנו את התפקיד שלך, הרשאות הניהול שלך יוסרו מיד.</p>
              )}
              <div><SubmitButton>שמירה</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

export function ToggleActiveForm({ member, isSelf }: { member: Staff; isSelf: boolean }) {
  const activate = !member.is_active;
  const message = activate
    ? `להפעיל מחדש את החשבון של ${member.full_name}? הוא/היא יקבלו שוב גישה לפי התפקיד שלהם.`
    : isSelf
      ? "להשבית את החשבון שלך? הגישה שלך תיחסם מיד ולא תוכלו להיכנס שוב בלי מנהל/ת מערכת אחר/ת."
      : `להשבית את החשבון של ${member.full_name}? הגישה למערכת תיחסם מיד. אפשר להפעיל מחדש בכל עת.`;
  return (
    <ActionForm action={setStaffActive} className="inline-block">
      <input type="hidden" name="id" value={member.id} />
      <input type="hidden" name="active" value={activate ? "true" : "false"} />
      <ConfirmSubmit message={message} variant={activate ? "secondary" : "danger"}>
        {activate ? "הפעלה מחדש" : "השבתה"}
        <span className="sr-only"> של {member.full_name}</span>
      </ConfirmSubmit>
    </ActionForm>
  );
}

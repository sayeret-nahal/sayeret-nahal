"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { saveEvent } from "@/app/(app)/calendar/actions";
import type { Lookup } from "@/lib/types";

export interface EventFormValues {
  id: string; title: string; date: string; time: string; location: string | null;
  cohort_id: number | null; region_id: number | null; description: string | null;
}

export function EventForm({ event, cohorts, regions, defaultDate, onDone }: {
  event?: EventFormValues; cohorts: Lookup[]; regions: Lookup[]; defaultDate: string; onDone?: () => void;
}) {
  const p = event ? `ev-${event.id.slice(0, 8)}` : "ev-new";
  return (
    <ActionForm action={saveEvent} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      {(state) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            {event && <input type="hidden" name="id" value={event.id} />}
            <Field label="שם האירוע" htmlFor={`${p}-title`} required error={fe.title}>
              <Input id={`${p}-title`} name="title" required maxLength={120} defaultValue={event?.title ?? ""} placeholder="לדוגמה: מפגש מחזור במרכז" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך" htmlFor={`${p}-date`} required error={fe.date}>
                <Input id={`${p}-date`} name="date" type="date" required defaultValue={event?.date ?? defaultDate} />
              </Field>
              <Field label="שעה" htmlFor={`${p}-time`} required error={fe.time}>
                <Input id={`${p}-time`} name="time" type="time" required defaultValue={event?.time ?? "19:00"} />
              </Field>
            </div>
            <Field label="מקום" htmlFor={`${p}-location`} error={fe.location}>
              <Input id={`${p}-location`} name="location" maxLength={200} defaultValue={event?.location ?? ""} placeholder="כתובת, אולם או קישור לשיחת וידאו" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="מחזור" htmlFor={`${p}-cohort`} hint="אם האירוע מיועד למחזור מסוים">
                <Select id={`${p}-cohort`} name="cohort_id" defaultValue={event?.cohort_id ?? ""}>
                  <option value="">כל המחזורים</option>
                  {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="אזור" htmlFor={`${p}-region`} hint="אם האירוע מיועד לאזור מסוים">
                <Select id={`${p}-region`} name="region_id" defaultValue={event?.region_id ?? ""}>
                  <option value="">כל האזורים</option>
                  {regions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="פרטים" htmlFor={`${p}-description`} error={fe.description}>
              <Textarea id={`${p}-description`} name="description" maxLength={2000} defaultValue={event?.description ?? ""} placeholder="מה מתוכנן, למי מיועד, מה להביא" />
            </Field>
            <SubmitButton>{event ? "שמירת שינויים" : "הוספה ללוח"}</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}

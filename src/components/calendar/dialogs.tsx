"use client";

// Client wrappers around <Modal>: a Server Component cannot pass the Modal's render-function
// child across the server/client boundary, so pages render these instead (all props serializable).

import { Pencil, Plus, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/client";
import type { Fallen, Lookup, Staff } from "@/lib/types";
import { EventForm, type EventFormValues } from "./event-form";
import { FallenForm } from "./fallen-form";
import { FamilyForm } from "./family-form";

export function AddEventDialog({ cohorts, regions, defaultDate }: { cohorts: Lookup[]; regions: Lookup[]; defaultDate: string }) {
  return (
    <Modal trigger={<><Plus className="size-4" aria-hidden />הוספת אירוע</>} title="אירוע חדש" triggerVariant="primary" triggerSize="sm" wide>
      {(close) => <EventForm cohorts={cohorts} regions={regions} defaultDate={defaultDate} onDone={close} />}
    </Modal>
  );
}

export function EditEventDialog({ event, cohorts, regions }: { event: EventFormValues; cohorts: Lookup[]; regions: Lookup[] }) {
  return (
    <Modal trigger={<><Pencil className="size-4" aria-hidden />עריכה<span className="sr-only"> של {event.title}</span></>} title="עריכת אירוע" triggerVariant="ghost" triggerSize="sm" wide>
      {(close) => <EventForm event={event} cohorts={cohorts} regions={regions} defaultDate={event.date} onDone={close} />}
    </Modal>
  );
}

export function FallenDialog({ fallen, cohorts, staff, maxDate }: {
  fallen?: Fallen; cohorts: Lookup[]; staff: Pick<Staff, "id" | "full_name">[]; maxDate: string;
}) {
  return (
    <Modal
      trigger={fallen ? <><Pencil className="size-4" aria-hidden />עריכת פרטים</> : <><Plus className="size-4" aria-hidden />הוספה לרשימה</>}
      title={fallen ? `עריכת הפרטים של ${fallen.first_name} ${fallen.last_name} ז״ל` : "הוספה לרשימת חללי היחידה"}
      triggerVariant={fallen ? "secondary" : "primary"}
      triggerSize="sm"
      wide
    >
      {(close) => <FallenForm fallen={fallen} cohorts={cohorts} staff={staff} maxDate={maxDate} onDone={close} />}
    </Modal>
  );
}

export function FamilyDialog({ fallenId }: { fallenId: string }) {
  return (
    <Modal trigger={<><UserPlus className="size-4" aria-hidden />קישור בן/בת משפחה</>} title="קישור בן/בת משפחה" triggerVariant="quiet" triggerSize="sm">
      {(close) => <FamilyForm fallenId={fallenId} onDone={close} />}
    </Modal>
  );
}

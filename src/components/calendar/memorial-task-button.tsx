"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ListPlus } from "lucide-react";
import { buttonClass } from "@/components/ui";
import type { ActionState } from "@/components/ui/client";
import { createMemorialTask } from "@/app/(app)/calendar/actions";

function Btn({ done, name }: { done: boolean; name: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || done} aria-busy={pending} className={buttonClass("secondary", "sm")}>
      {done ? <Check className="size-4 text-ok" aria-hidden /> : <ListPlus className="size-4" aria-hidden />}
      {pending ? "יוצר…" : done ? "נוצרה משימה" : "משימה: ליצור קשר עם המשפחה"}
      <span className="sr-only"> של {name}</span>
    </button>
  );
}

/** One click: creates a "contact the family" task (server decides due date, assignee and contact). */
export function MemorialTaskButton({ fallenId, occasion, name }: { fallenId: string; occasion: "azkara" | "anniversary"; name: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createMemorialTask, {});
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="fallen_id" value={fallenId} />
      <input type="hidden" name="occasion" value={occasion} />
      <Btn done={!!state.ok} name={name} />
      {state.error && <p role="alert" className="text-[12px] text-danger">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-[12px] text-ok">{state.message}</p>}
    </form>
  );
}

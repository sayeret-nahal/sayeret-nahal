"use client";

import { EmergencyBox } from "./_lib/ui";

export default function PublicError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">משהו השתבש אצלנו</h1>
      <p className="text-ink-2">הטופס לא נטען כרגע. אפשר לנסות שוב בעוד רגע.</p>
      <EmergencyBox />
      <button type="button" onClick={reset} className="h-11 rounded-lg bg-brand text-white font-medium">ניסיון נוסף</button>
    </div>
  );
}

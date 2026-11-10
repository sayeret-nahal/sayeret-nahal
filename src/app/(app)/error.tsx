"use client";

import { Card, EmptyState, Button } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <EmptyState title="משהו השתבש בטעינת הדף" action={<Button variant="primary" onClick={reset}>ניסיון נוסף</Button>}>
        ייתכן שזו תקלה זמנית בחיבור. אם זה חוזר, פנו למנהל/ת המערכת.
      </EmptyState>
    </Card>
  );
}

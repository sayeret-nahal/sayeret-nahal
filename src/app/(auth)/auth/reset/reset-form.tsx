"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";

export function ResetForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 12) { setError("הסיסמה צריכה להיות באורך 12 תווים לפחות"); return; }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setError("לא הצלחנו לעדכן את הסיסמה. ייתכן שצריך קודם להשלים אימות דו-שלבי — נסו להיכנס מחדש."); return; }
    router.replace("/auth/mfa");
  }
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold mb-4">בחירת סיסמה חדשה</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="סיסמה חדשה" htmlFor="new-password" required hint="12 תווים לפחות" error={error ?? undefined}>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={12} required dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "שומר…" : "שמירה"}</Button>
      </form>
    </Card>
  );
}

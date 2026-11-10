"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, Field, Input } from "@/components/ui";
import { demoSignIn, requestPasswordReset, signIn, signUp } from "./actions";

const DEMO = [
  { role: "admin", label: "מנהל/ת מערכת", hint: "רואה הכול" },
  { role: "coordinator", label: "רכז/ת קהילה", hint: "כל הקהילה והפניות" },
  { role: "cohort_lead", label: "אחראי/ת מחזור", hint: "מחזור נובמבר 2012" },
  { role: "donor_coordinator", label: "רכז/ת תורמים", hint: "תורמים בלבד" },
  { role: "volunteer", label: "מתנדב/ת", hint: "רק מי שהוקצה" },
];

export function LoginForm({ next, notice, demo }: { next?: string; notice?: string; demo?: boolean }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  return (
    <>
    {demo && mode === "in" && (
      <Card className="p-6 mb-4 border-brand/30">
        <h2 className="text-lg font-semibold mb-1">כניסה מהירה למערכת הדוגמה</h2>
        <p className="text-sm text-ink-2 mb-4">בלי שם משתמש וסיסמה. בוחרים תפקיד ורואים את המערכת כמו שהוא/היא רואה אותה. כל הנתונים במערכת הזו בדויים.</p>
        <div className="grid gap-2">
          {DEMO.map((d) => (
            <form key={d.role} action={demoSignIn}>
              <input type="hidden" name="role" value={d.role} />
              <button className="w-full flex items-center justify-between rounded-lg border border-line-strong hover:border-brand hover:bg-brand-soft px-3 h-11 text-sm">
                <span className="font-medium">{d.label}</span>
                <span className="text-[12px] text-ink-3">{d.hint}</span>
              </button>
            </form>
          ))}
        </div>
      </Card>
    )}
    <Card className="p-6">
      <h1 className="text-xl font-semibold mb-1">{mode === "in" ? "כניסה למערכת" : mode === "up" ? "הפעלת חשבון חדש" : "איפוס סיסמה"}</h1>
      <p className="text-sm text-ink-2 mb-5">
        {mode === "in" ? "לצוות העמותה בלבד." : mode === "up" ? "רק לכתובת שמנהל/ת המערכת הזמין/ה." : "נשלח אליך קישור לבחירת סיסמה חדשה."}
      </p>
      {notice && <p role="status" className="text-sm text-warn bg-warn-soft rounded-lg px-3 py-2 mb-4">{notice}</p>}
      <ActionForm action={mode === "in" ? signIn : mode === "up" ? signUp : requestPasswordReset} className="flex flex-col gap-4" key={mode}>
        <input type="hidden" name="next" value={next ?? "/"} />
        <Field label="דוא״ל" htmlFor="email" required>
          <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
        </Field>
        {mode !== "reset" && (
          <Field label="סיסמה" htmlFor="password" required hint={mode === "up" ? "12 תווים לפחות" : undefined}>
            <Input id="password" name="password" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "up" ? 12 : undefined} dir="ltr" />
          </Field>
        )}
        <SubmitButton pendingText="רגע…">{mode === "in" ? "כניסה" : mode === "up" ? "יצירת חשבון" : "שליחת קישור"}</SubmitButton>
      </ActionForm>
      <div className="mt-4 flex flex-col items-start gap-2 text-sm">
        {mode !== "up" && <button type="button" onClick={() => setMode("up")} className="text-brand hover:underline">קיבלתי הזמנה וזו הפעם הראשונה שלי</button>}
        {mode !== "reset" && <button type="button" onClick={() => setMode("reset")} className="text-brand hover:underline">שכחתי סיסמה</button>}
        {mode !== "in" && <button type="button" onClick={() => setMode("in")} className="text-brand hover:underline">חזרה לכניסה</button>}
      </div>
    </Card>
    </>
  );
}

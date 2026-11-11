import { Card, CardHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";

// Answers from the public "join the community" questionnaire, in the order the form asks them.
const LABELS: [string, string][] = [
  ["region", "אזור"], ["connection", "חיבור לסיירת"], ["fallen_name", "שם החלל/ה"], ["fallen_relation", "קרבה"],
  ["enlist_year", "שנת גיוס"], ["enlist_month", "חודש גיוס"], ["last_role", "תפקיד אחרון"], ["commander", "מפקד/ת"],
  ["status", "מה עושה היום"], ["study_institution", "מוסד לימודים"], ["study_field", "תחום לימודים"], ["study_year", "שנה"],
  ["scholars_interest", "מעוניין/ת במלגת ״מילגאים״"], ["work_field", "תחום עבודה"], ["work_role", "תפקיד"], ["work_experience", "ניסיון"],
  ["interests", "במה נוכל לעזור"], ["memorial_fallen", "חלל/ה שרוצה להישאר מחובר/ת אליו"], ["memorial_assign", "מוכן/ה ללוות משפחה/הנצחה"],
  ["personal", "נושאים אישיים"], ["knows", "מכיר/ה מישהו ש…"], ["personal_contact", "איך ליצור קשר / פרטים"],
  ["give", "מה מביא/ה לקהילה"], ["fundraising", "מכיר/ה לגיוס"], ["volunteer_areas", "תחום לריכוז"], ["offer", "מה יכול/ה להציע"],
  ["idea", "רעיון / הערה"], ["platforms", "פעיל/ה ב"], ["consent", "הסכמה לקבלת עדכונים"], ["ref", "הגיע/ה דרך"],
];

function show(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "כן" : null;
  if (Array.isArray(v)) return v.length ? v.join(" · ") : null;
  return String(v);
}

export function JoinAnswers({ received, answers, source }: { received: string; answers: Record<string, unknown>; source?: string | null }) {
  const rows = LABELS.map(([k, label]) => [label, show(k === "ref" ? source : answers[k])] as const).filter(([, v]) => v);
  return (
    <Card>
      <CardHeader title="טופס ההצטרפות" subtitle={`מולא ב-${formatDate(received)}`} />
      <dl className="px-5 pb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, v]) => (
          <div key={label} className="contents"><dt className="text-ink-3">{label}</dt><dd className="whitespace-pre-line">{v}</dd></div>
        ))}
      </dl>
    </Card>
  );
}

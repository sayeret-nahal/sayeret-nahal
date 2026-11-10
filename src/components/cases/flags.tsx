import { AlertTriangle, Clock, FileWarning, UserX } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { relativeDay } from "@/lib/dates";
import type { CaseAlert, CaseKind, CaseStatus } from "@/lib/types";

// Shared helpers for the cases module: red flags, deadlines, "who" and badges.

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Current time (kept out of component bodies so render stays pure for the linter). */
export function nowMs(): number {
  return Date.now();
}

/** "שעתיים", "5 שעות", "יום", "יומיים", "8 ימים" */
export function spanText(ms: number): string {
  const h = Math.floor(ms / HOUR);
  if (h < 1) return "פחות משעה";
  if (h < 24) return h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  const d = Math.floor(ms / DAY);
  return d === 1 ? "יום" : d === 2 ? "יומיים" : `${d} ימים`;
}

/** Date (YYYY-MM-DD) in Israel for a timestamp. */
export function ilDate(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(ts));
}

export function isLate(dueAt: string, status: CaseStatus, now: number): boolean {
  return status !== "resolved" && Date.parse(dueAt) < now;
}

/** Short deadline text: "באיחור של 3 ימים", "בעוד 5 שעות", "מחר", "בעוד שבוע"… */
export function dueText(dueAt: string, status: CaseStatus, now: number): string {
  if (status === "resolved") return "";
  const diff = Date.parse(dueAt) - now;
  if (diff < 0) return `באיחור של ${spanText(-diff)}`;
  if (diff < DAY) return `בעוד ${spanText(diff)}`;
  return relativeDay(ilDate(dueAt));
}

export type FlagKey = "unassigned" | "overdue" | "stalled" | "closed_without_action";
export interface Flag { key: FlagKey; label: string; explain: string }

type AlertLike = Pick<CaseAlert, "unassigned" | "overdue" | "stalled" | "closed_without_action">;

/** Red flags with plain explanations, from the case_alerts view (computed by the database). */
export function caseFlags(alert: AlertLike | undefined | null, c: { due_at: string; last_activity_at: string }, now: number): Flag[] {
  if (!alert) return [];
  const flags: Flag[] = [];
  if (alert.overdue) {
    flags.push({ key: "overdue", label: `באיחור של ${spanText(now - Date.parse(c.due_at))}`, explain: "המועד שנקבע לטיפול עבר, והפנייה עדיין פתוחה." });
  }
  if (alert.unassigned) {
    flags.push({ key: "unassigned", label: "ללא אחראי", explain: "אף אחד עדיין לא לקח אחריות על הפנייה." });
  }
  if (alert.stalled) {
    flags.push({ key: "stalled", label: `אין פעילות ${spanText(now - Date.parse(c.last_activity_at))}`, explain: "לא תועדה שום פעולה בשבוע האחרון." });
  }
  if (alert.closed_without_action) {
    flags.push({ key: "closed_without_action", label: "נסגרה בלי תיעוד פעולה", explain: "הפנייה נסגרה בלי שנרשמה הערה או שיחה." });
  }
  return flags;
}

const FLAG_ICON = { overdue: Clock, unassigned: UserX, stalled: AlertTriangle, closed_without_action: FileWarning } as const;

export function FlagChips({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => {
        const Icon = FLAG_ICON[f.key];
        return (
          <Badge key={f.key} tone={f.key === "overdue" || f.key === "unassigned" ? "danger" : "warn"} title={f.explain}>
            <Icon className="size-3" aria-hidden />
            {f.label}
          </Badge>
        );
      })}
    </span>
  );
}

export function KindBadge({ kind }: { kind: CaseKind }) {
  return kind === "concern"
    ? <Badge tone="danger"><AlertTriangle className="size-3" aria-hidden />דיווח חשש</Badge>
    : <Badge tone="info">פנייה</Badge>;
}

export const STATUS_TONE: Record<CaseStatus, Tone> = { new: "brand", in_progress: "info", waiting: "warn", resolved: "ok" };
export const PRIORITY_TONE = { normal: "neutral", high: "warn", urgent: "danger" } as const satisfies Record<string, Tone>;

/** Who the case is about / from, for lists and headers. */
export function caseWho(c: { kind: CaseKind; subject_name: string | null; requester_name: string | null; contacts?: { full_name: string } | null }): string {
  if (c.contacts?.full_name) return c.contacts.full_name;
  if (c.kind === "concern" && c.subject_name) return c.subject_name.split(" · ")[0];
  return c.requester_name ?? c.subject_name ?? "";
}

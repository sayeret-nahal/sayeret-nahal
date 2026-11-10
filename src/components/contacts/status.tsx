import { Badge, type Tone } from "@/components/ui";
import type { CareStatus } from "@/lib/types";

export function severityTone(severity: number | undefined, code?: string): Tone {
  if (code === "lost") return "neutral";
  if (severity === 3) return "danger";
  if (severity === 2) return "warn";
  if (severity === 1) return "info";
  return "ok";
}

export function CareBadge({ status }: { status: CareStatus | undefined }) {
  if (!status) return null;
  return <Badge tone={severityTone(status.severity, status.code)}>{status.label}</Badge>;
}

export function TypeChips({ codes, label }: { codes: string[]; label: (c: string) => string }) {
  if (!codes.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((c) => <Badge key={c} tone={c === "pink" ? "pink" : "neutral"}>{label(c)}</Badge>)}
    </span>
  );
}

import type { Tone } from "@/components/ui";

export const BROADCAST_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "טיוטה — ממתינה לאישור", tone: "warn" },
  queued: { label: "אושרה, בתור לשליחה", tone: "info" },
  sending: { label: "נשלחת", tone: "info" },
  sent: { label: "נשלחה", tone: "ok" },
  cancelled: { label: "בוטלה", tone: "neutral" },
};

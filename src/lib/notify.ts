// Server-side only (reads secret env vars). Import it only from server actions / server code.

/**
 * E-mail alert to the team when a public form creates a case.
 * E-mail is not a secure channel: the message carries only the reference number,
 * the kind of request and a first name. Everything else stays inside the system.
 * No-op unless RESEND_API_KEY, ALERT_EMAIL_FROM and ALERT_EMAIL_TO are set.
 */
export async function notifyNewPublicCase({ ref, kind, name }: { ref: number; kind: "request" | "concern"; name?: string | null }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  const to = process.env.ALERT_EMAIL_TO;
  if (!key || !from || !to || !ref) return;

  const firstName = (name ?? "").trim().split(/\s+/)[0]?.slice(0, 30) ?? "";
  const what = kind === "concern" ? "דיווח חשש לגבי חבר" : "בקשה לשיחה";
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const lines = [
    `התקבלה פנייה חדשה #${ref} — היכנסו למערכת.`,
    `סוג: ${what}${firstName ? ` · מאת: ${firstName}` : ""}`,
    ...(base ? [`לרשימת הפניות: ${base}/cases`] : []),
    "מטעמי פרטיות, הפרטים המלאים מופיעים רק במערכת.",
  ];

  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${lines
    .map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`)
    .join("")}</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      subject: `התקבלה פנייה חדשה #${ref} — היכנסו למערכת`,
      text: lines.join("\n"),
      html,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`notify failed: ${res.status}`);
}

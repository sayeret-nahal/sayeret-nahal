// Mirrors public.normalize_il_phone in the database.
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/[^0-9+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) {
    d = d.replace(/\D/g, "");
    if (!d.startsWith("972")) return d.length >= 8 && d.length <= 15 ? "+" + d : null;
  }
  d = d.replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("972")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 8 && d.length <= 9 ? "+972" + d : null;
}

/** +972521234567 → 052-123-4567 */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  if (!e164.startsWith("+972")) return e164;
  const local = "0" + e164.slice(4);
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  if (local.length === 9) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  return local;
}

export function whatsappLink(e164: string, text?: string): string {
  const n = e164.replace(/\D/g, "");
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

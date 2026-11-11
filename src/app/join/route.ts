import { headers } from "next/headers";
import { JOIN_HTML } from "./page-html";

export const dynamic = "force-dynamic";

// Serves the join landing page. Its inline <script>/<style> get this request's CSP nonce (set in src/proxy.ts).
export async function GET() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const html = nonce ? JOIN_HTML.replace(/<(script|style)(?=[\s>])/g, `<$1 nonce="${nonce}"`) : JOIN_HTML;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

"use client";

import { useEffect } from "react";

// Cloudflare Turnstile widget. It adds a hidden "cf-turnstile-response" field to the surrounding form.
// Renders nothing until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. The script is added by our own (nonce-trusted)
// bundle, which the CSP's 'strict-dynamic' allows.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function Turnstile() {
  useEffect(() => {
    if (!SITE_KEY || document.querySelector(`script[src="${SRC}"]`)) return;
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, []);
  if (!SITE_KEY) return null;
  return <div className="cf-turnstile" data-sitekey={SITE_KEY} data-language="he" data-theme="light" />;
}

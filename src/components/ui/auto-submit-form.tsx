"use client";

import { useRouter, usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** GET filter form that applies on every change (still works as a normal form without JS). */
export function AutoSubmitForm({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <form
      method="get"
      className={className}
      onChange={(e) => {
        const form = e.currentTarget;
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName === "INPUT" && t.type === "search") return;
        const params = new URLSearchParams();
        new FormData(form).forEach((v, k) => { if (String(v)) params.append(k, String(v)); });
        router.replace(`${path}?${params.toString()}`);
      }}
    >
      {children}
    </form>
  );
}

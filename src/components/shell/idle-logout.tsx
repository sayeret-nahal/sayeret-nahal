"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Signs the user out after a period without activity (data-security regulations). */
export function IdleLogout({ minutes }: { minutes: number }) {
  const [warn, setWarn] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const bump = () => { last.current = Date.now(); setWarn(false); };
    const events = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(async () => {
      const idle = (Date.now() - last.current) / 60000;
      if (idle >= minutes) {
        clearInterval(iv);
        await createClient().auth.signOut();
        window.location.assign(new URL("/login?reason=idle", window.location.origin));
      } else if (idle >= minutes - 1) setWarn(true);
    }, 15000);
    return () => { clearInterval(iv); events.forEach((e) => window.removeEventListener(e, bump)); };
  }, [minutes]);
  if (!warn) return null;
  return (
    <div role="alert" className="fixed bottom-20 lg:bottom-6 inset-x-4 lg:inset-x-auto lg:start-6 z-50 rounded-lg bg-ink text-white px-4 py-3 text-sm shadow-lg">
      בעוד דקה תתבצע התנתקות אוטומטית. געו במסך או הקישו על מקש כדי להישאר מחוברים.
    </div>
  );
}

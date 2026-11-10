import Image from "next/image";
import Link from "next/link";
import { getPublicSettings } from "./_lib/settings";

// Public pages (no login): talk request, concern report, self-update.
// Deliberately no staff navigation and no requireStaff(); data goes only through anon RPCs.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const s = await getPublicSettings();
  const org = s.org_name ?? "עמותת סיירת נחל";
  return (
    <div className="min-h-dvh flex flex-col bg-linear-to-b from-sand via-canvas to-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 bg-surface px-3 py-2 rounded-lg">דילוג לתוכן</a>
      <header className="px-4 pt-6 pb-4 sm:pt-10">
        <div className="mx-auto max-w-lg flex items-center gap-3">
          <Image src="/brand/emblem.png" alt="" width={84} height={39} priority className="h-auto w-[84px] shrink-0" />
          <div className="leading-tight">
            <p className="text-[16px] font-bold text-ink">{org}</p>
            <p className="text-[12px] text-ink-3">קהילה ששומרת אחד על השני</p>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1 px-4 pb-12">
        <div className="mx-auto max-w-lg">{children}</div>
      </main>
      <footer className="px-4 pb-8 text-center text-[12px] text-ink-3">
        <nav aria-label="קישורים" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link href="/talk" className="hover:text-ink hover:underline">צריך/ה לדבר עם מישהו?</Link>
          <Link href="/concern" className="hover:text-ink hover:underline">מודאג/ת לגבי חבר?</Link>
        </nav>
      </footer>
    </div>
  );
}

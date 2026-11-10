import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-olive-dark bg-[radial-gradient(ellipse_at_top,_#55692f_0%,_#425525_45%,_#2f3d18_100%)]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <Image src="/brand/logo-on-dark.png" alt="עמותת סיירת נח״ל" width={220} height={144} priority className="mx-auto h-auto w-[200px]" />
          <p className="mt-3 text-sm text-sage">מערכת הקשר עם הקהילה</p>
        </div>
        {children}
      </div>
    </main>
  );
}

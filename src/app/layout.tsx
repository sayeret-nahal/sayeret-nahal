import type { Metadata, Viewport } from "next";
import { Assistant, Poppins } from "next/font/google";
import "./globals.css";

const assistant = Assistant({ subsets: ["hebrew", "latin"], variable: "--font-assistant", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  title: { default: "סיירת נחל · קשר עם הקהילה", template: "%s · סיירת נחל" },
  description: "מערכת לניהול הקשר עם לוחמי ויוצאי סיירת נחל, משפחותיהם, תורמים ומתנדבים",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#425525" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={`${assistant.variable} ${poppins.variable}`}>
      <body className="font-sans antialiased min-h-dvh">{children}</body>
    </html>
  );
}

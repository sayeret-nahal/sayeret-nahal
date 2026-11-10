import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">הדף לא נמצא</h1>
        <p className="text-ink-2 mt-2">ייתכן שהקישור שגוי, או שאין לך הרשאה לראות את הרשומה הזאת.</p>
        <Link href="/" className="inline-block mt-5 text-brand underline">חזרה לדף הבית</Link>
      </div>
    </main>
  );
}

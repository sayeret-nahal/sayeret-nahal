// Minimal frame for embedding public forms in the association's website (<iframe>).
// Which sites may embed it is controlled by WEBSITE_ORIGINS (see next.config.ts).
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <main className="bg-transparent p-3 sm:p-4"><div className="mx-auto max-w-lg">{children}</div></main>;
}

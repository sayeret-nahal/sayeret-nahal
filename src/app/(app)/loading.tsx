export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">טוען…</span>
      <div className="h-7 w-48 rounded bg-muted-soft mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-[var(--radius-card)] bg-surface border border-line" />)}
      </div>
      <div className="h-64 rounded-[var(--radius-card)] bg-surface border border-line" />
    </div>
  );
}

"use client";

import { useEffect, useId, useState } from "react";
import { Search, UserRound, X } from "lucide-react";
import { buttonClass, cx } from "@/components/ui";
import { displayPhone } from "@/lib/phone";

export interface PersonResult { id: string; name: string; phone: string | null; cohort: string | null; city: string | null }

/**
 * Search-as-you-type person picker (uses /api/search, filtered by RLS).
 * Keeps the chosen id in a hidden input named `name`, so it works inside any <form>.
 */
export function PersonPicker({ id, name = "contact_id", initial = null, onChange, invalid, describedBy, autoFocus }: {
  id: string;
  name?: string;
  initial?: { id: string; name: string } | null;
  onChange?: (p: PersonResult | null) => void;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const [selected, setSelected] = useState<PersonResult | null>(
    initial ? { id: initial.id, name: initial.name, phone: null, cohort: null, city: null } : null,
  );
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        const j = (await r.json()) as { results?: PersonResult[] };
        if (!r.ok) setFailed(true);
        setResults(j.results ?? []);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  function choose(p: PersonResult | null) {
    setSelected(p);
    setOpen(false);
    setQ("");
    setResults([]);
    onChange?.(p);
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2">
        <input type="hidden" name={name} value={selected.id} />
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid size-8 place-items-center rounded-full bg-surface text-brand shrink-0" aria-hidden><UserRound className="size-4" /></span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate" id={`${id}-chosen`}>{selected.name}</div>
            {(selected.cohort || selected.city || selected.phone) && (
              <div className="text-[12px] text-ink-3 flex flex-wrap gap-x-2">
                {selected.cohort && <span>{selected.cohort}</span>}
                {selected.city && <span>{selected.city}</span>}
                {selected.phone && <span dir="ltr">{displayPhone(selected.phone)}</span>}
              </div>
            )}
          </div>
        </div>
        <button type="button" id={id} onClick={() => choose(null)} className={buttonClass("ghost", "sm")} aria-describedby={`${id}-chosen`}>
          <X className="size-3.5" aria-hidden />החלפה
        </button>
      </div>
    );
  }

  const showList = open && q.trim().length >= 2;
  return (
    <div className="relative">
      <input type="hidden" name={name} value="" />
      <Search className="absolute top-1/2 -translate-y-1/2 start-3 size-4 text-ink-3 pointer-events-none" aria-hidden />
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={showList && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="שם, טלפון או מחזור…"
        className={cx(
          "w-full h-10 rounded-lg border bg-surface ps-9 pe-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
          invalid ? "border-danger" : "border-line-strong",
        )}
        value={q}
        onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { setResults([]); setOpen(false); } }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (showList && results[active]) choose(results[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      <p className="sr-only" aria-live="polite">
        {loading ? "מחפש…" : showList ? (results.length ? `נמצאו ${results.length} אנשים` : "לא נמצאו אנשים") : ""}
      </p>
      {showList && (
        <ul id={listId} role="listbox" aria-label="תוצאות חיפוש" className="absolute z-40 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg overflow-hidden">
          {results.length === 0 && !loading && (
            <li className="px-3 py-3 text-sm text-ink-3">{failed ? "החיפוש נכשל. נסו שוב." : "לא נמצא אדם כזה במערכת (או שאין לך הרשאה לראות אותו)."}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
              onMouseEnter={() => setActive(i)}
              className={cx("px-3 py-2 cursor-pointer", i === active && "bg-brand-soft")}
            >
              <div className="text-sm font-medium text-ink">{r.name}</div>
              <div className="text-[12px] text-ink-3 flex flex-wrap gap-x-2">
                {r.cohort && <span>{r.cohort}</span>}
                {r.city && <span>{r.city}</span>}
                {r.phone && <span dir="ltr">{displayPhone(r.phone)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

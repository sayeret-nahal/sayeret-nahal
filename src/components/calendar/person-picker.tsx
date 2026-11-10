"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { displayPhone } from "@/lib/phone";

export interface PickedPerson { id: string; name: string; phone: string | null; cohort: string | null; city: string | null }

/**
 * Accessible person search (combobox) backed by /api/search. Results are already filtered by RLS
 * to the people this user may see. The chosen id is submitted as a hidden input named `name`.
 */
export function PersonPicker({ id, name, required, invalid, describedBy, onChange }: {
  id: string; name: string; required?: boolean; invalid?: boolean; describedBy?: string; onChange?: (p: PickedPerson | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedPerson[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<PickedPerson | null>(null);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // native validation: the form can't be submitted until a person is chosen from the list
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !picked ? "נא לחפש ולבחור אדם מהרשימה" : "");
  }, [required, picked]);

  function search(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    ctrl.current?.abort();
    if (value.trim().length < 2) { setResults([]); setOpen(false); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const c = new AbortController();
      ctrl.current = c;
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(value)}`, { signal: c.signal });
        const j = await r.json();
        setFailed(!r.ok);
        setResults(j.results ?? []);
        setActive(0);
        setOpen(true);
        setLoading(false);
      } catch {
        // aborted by a newer search → ignore; otherwise show the failure
        if (!c.signal.aborted) { setFailed(true); setResults([]); setOpen(true); setLoading(false); }
      }
    }, 200);
  }

  function choose(p: PickedPerson) {
    setPicked(p);
    setOpen(false);
    setQ("");
    setResults([]);
    onChange?.(p);
  }

  function clear() {
    setPicked(null);
    onChange?.(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  if (picked) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2">
        <input type="hidden" name={name} value={picked.id} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink" id={`${id}-picked`}>{picked.name}</div>
          <div className="text-[12px] text-ink-2 flex flex-wrap gap-x-2">
            {picked.cohort && <span>{picked.cohort}</span>}
            {picked.city && <span>{picked.city}</span>}
            {picked.phone && <span dir="ltr">{displayPhone(picked.phone)}</span>}
          </div>
        </div>
        <button type="button" onClick={clear} className={buttonClass("ghost", "sm")} aria-label={`החלפת ${picked.name}`}>
          <X className="size-4" aria-hidden /> החלפה
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute top-1/2 -translate-y-1/2 start-3 size-4 text-ink-3 pointer-events-none" aria-hidden />
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="הקלידו שם, טלפון או מחזור"
        value={q}
        onChange={(e) => search(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && results[active]) choose(results[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full h-10 rounded-lg border border-line-strong bg-surface ps-9 pe-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger"
      />
      <p className="sr-only" aria-live="polite">{loading ? "מחפש…" : open ? `${results.length} תוצאות` : ""}</p>
      {open && q.trim().length >= 2 && (
        <ul id={listId} role="listbox" aria-label="תוצאות חיפוש" className="absolute z-50 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-3">
              {failed ? "החיפוש נכשל. נסו שוב." : (
                <>לא נמצאו אנשים בשם הזה. <a className="text-brand underline" href={`/contacts/new?name=${encodeURIComponent(q.trim())}`} target="_blank" rel="noopener">הוספת אדם חדש</a> ואז לחפש שוב.</>
              )}
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer ${i === active ? "bg-brand-soft" : ""}`}
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

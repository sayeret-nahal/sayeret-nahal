"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { displayPhone } from "@/lib/phone";

interface Result { id: string; name: string; phone: string | null; cohort: string | null; city: string | null }

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [fetched, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = await r.json();
        setResults(j.results ?? []);
        setActive(0);
        setOpen(true);
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const results = q.trim().length < 2 ? [] : fetched;

  function go(r: Result) {
    setOpen(false);
    setQ("");
    router.push(`/contacts/${r.id}`);
  }

  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="global-search" className="sr-only">חיפוש אדם</label>
      <Search className="absolute top-1/2 -translate-y-1/2 start-3 size-4 text-ink-3 pointer-events-none" aria-hidden />
      <input
        ref={inputRef}
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        placeholder="חיפוש לפי שם, טלפון, דוא״ל או מחזור"
        className="w-full h-10 rounded-lg border border-control bg-surface ps-9 pe-3 text-sm placeholder:text-ink-3 focus:bg-surface focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        value={q}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            if (results[active]) go(results[active]);
            else if (q.trim()) router.push(`/contacts?q=${encodeURIComponent(q.trim())}`);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg overflow-hidden">
          {results.length === 0 && !loading && <li className="px-3 py-3 text-sm text-ink-3">לא נמצאו אנשים. <a className="text-brand underline" href={`/contacts/new?name=${encodeURIComponent(q)}`}>הוספת אדם חדש</a></li>}
          {results.map((r, i) => (
            <li key={r.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(r); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer ${i === active ? "bg-brand-soft" : ""}`}>
              <div className="text-sm font-medium text-ink">{r.name}</div>
              <div className="text-[12px] text-ink-3 flex gap-2">
                {r.cohort && <span>{r.cohort}</span>}
                {r.city && <span>{r.city}</span>}
                {r.phone && <span dir="ltr">{displayPhone(r.phone)}</span>}
              </div>
            </li>
          ))}
          {results.length > 0 && (
            <li className="border-t border-line">
              <a href={`/contacts?q=${encodeURIComponent(q)}`} className="block px-3 py-2 text-[13px] text-brand hover:bg-canvas">כל התוצאות ←</a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

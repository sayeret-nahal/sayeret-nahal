"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Check, Circle, FileSpreadsheet, Upload, Users, HandCoins } from "lucide-react";
import { Button, Card, CardHeader, Checkbox, Field, Input, LinkButton, Notice, Select, Stat, buttonClass, cx } from "@/components/ui";
import { commitImport, parseImportFile, previewImport } from "@/app/(app)/contacts/import/actions";
import {
  FIELD_LABELS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, MODE_FIELDS,
  type ImportField, type ImportMode, type Mapping, type PlanRow,
} from "@/lib/import";
import type { CommitResult, Fail, ImportOptions, ParsedFile, PreviewResult } from "./types";
import { DownloadButton, RowsTable, type RowFilter } from "./import-rows";

type Opt = { id: number; label: string };

const STEPS = ["העלאת קובץ", "התאמת עמודות", "בדיקה", "סיום"] as const;
const EMPTY_OPTIONS: ImportOptions = { typeCode: "", defaultCohortId: null, defaultRegionId: null, defaultOwnerId: null, sourceNote: "" };
const NETWORK_ERROR = "הפעולה לא הושלמה. ייתכן שהקובץ גדול מדי לשליחה או שהחיבור נקטע. נסו שוב, או פצלו את הקובץ לקבצים קטנים יותר.";

export function ImportWizard({ canDonations, isAdmin, ownerLocked, types, cohorts, regions, staff }: {
  canDonations: boolean;
  isAdmin: boolean;
  ownerLocked: boolean;
  types: { code: string; label: string }[];
  cohorts: Opt[];
  regions: Opt[];
  staff: { id: string; name: string }[];
}) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ImportMode>("contacts");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Mapping>([]);
  const [options, setOptions] = useState<ImportOptions>(EMPTY_OPTIONS);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [createCohorts, setCreateCohorts] = useState(false);
  const [createDonors, setCreateDonors] = useState(true);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus to the step title when the step changes (screen readers announce the new step).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  function fd(extra: Record<string, string> = {}) {
    const f = new FormData();
    f.set("mode", mode);
    if (file) f.set("file", file);
    if (parsed) f.set("fingerprint", parsed.fingerprint);
    f.set("mapping", JSON.stringify(mapping));
    f.set("options", JSON.stringify(options));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  function run<T extends { ok: true }>(call: () => Promise<T | Fail>, done: (r: T) => void) {
    setError(null);
    start(async () => {
      try {
        const r = await call();
        if (r.ok) done(r);
        else setError(r.error);
      } catch {
        setError(NETWORK_ERROR);
      }
    });
  }

  function chooseFile(f: File | null) {
    setError(null);
    setParsed(null);
    setPreview(null);
    if (f && f.size > IMPORT_MAX_BYTES) { setFile(null); setError("הקובץ גדול מ-5MB. פצלו אותו לכמה קבצים קטנים יותר."); return; }
    setFile(f);
  }

  const restart = () => {
    setStep(0); setFile(null); setParsed(null); setMapping([]); setOptions(EMPTY_OPTIONS);
    setPreview(null); setResult(null); setError(null); setCreateCohorts(false); setCreateDonors(true);
  };

  const title = step === 0 ? "מה מייבאים, ומאיזה קובץ?" : step === 1 ? "איזה מידע יש בכל עמודה?" : step === 2 ? "מה יקרה לכל שורה" : "הייבוא הסתיים";

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label="שלבי הייבוא">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span className={cx(
              "grid size-6 place-items-center rounded-full text-[12px] font-semibold",
              i < step ? "bg-brand-soft text-brand-strong" : i === step ? "bg-brand text-white" : "bg-muted-soft text-ink-3",
            )}>
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={i === step ? "font-medium text-ink" : "text-ink-3"}>{s}</span>
            {i < STEPS.length - 1 && <span className="text-line-strong mx-1" aria-hidden>—</span>}
          </li>
        ))}
      </ol>

      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">{title}</h2>

      {error && <Notice tone="danger" title="משהו לא הסתדר">{error}</Notice>}

      {step === 0 && (
        <StepUpload
          mode={mode} setMode={(m) => { setMode(m); setParsed(null); setPreview(null); }}
          canDonations={canDonations} file={file} chooseFile={chooseFile} pending={pending}
          onNext={() => run(() => parseImportFile(fd()), (r) => {
            setParsed(r); setMapping(r.mapping); setPreview(null); setStep(1);
          })}
        />
      )}

      {step === 1 && parsed && (
        <StepMapping
          mode={mode} parsed={parsed} mapping={mapping} setMapping={(m) => { setMapping(m); setPreview(null); }}
          options={options} setOptions={(o) => { setOptions(o); setPreview(null); }}
          types={types} cohorts={cohorts} regions={regions} staff={staff} ownerLocked={ownerLocked} pending={pending}
          onBack={() => setStep(0)}
          onNext={() => run(() => previewImport(fd()), (r) => { setPreview(r); setStep(2); })}
        />
      )}

      {step === 2 && preview && (
        <StepPreview
          preview={preview} isAdmin={isAdmin} pending={pending}
          createCohorts={createCohorts} setCreateCohorts={setCreateCohorts}
          createDonors={createDonors} setCreateDonors={setCreateDonors}
          onBack={() => setStep(1)}
          onCommit={() => run(
            () => commitImport(fd({ confirm: "yes", createCohorts: createCohorts ? "yes" : "no", createDonors: createDonors ? "yes" : "no" })),
            (r) => { setResult(r); setStep(3); },
          )}
        />
      )}

      {step === 3 && result && <StepResult result={result} fileName={parsed?.fileName ?? "import"} createDonors={createDonors} onRestart={restart} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — upload
// ---------------------------------------------------------------------------

function StepUpload({ mode, setMode, canDonations, file, chooseFile, pending, onNext }: {
  mode: ImportMode; setMode: (m: ImportMode) => void; canDonations: boolean; file: File | null;
  chooseFile: (f: File | null) => void; pending: boolean; onNext: () => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <>
      {canDonations && (
        <fieldset>
          <legend className="text-[13px] font-medium text-ink mb-2">מה יש בקובץ?</legend>
          <div className="grid sm:grid-cols-2 gap-3">
            <ModeCard checked={mode === "contacts"} onChange={() => setMode("contacts")} icon={<Users className="size-5" aria-hidden />}
              title="אנשים" text="רשימת חברים, אנשי קשר או משתתפים — מאקסל, מגוגל שיטס או מייצוא של קבוצה." />
            <ModeCard checked={mode === "donations"} onChange={() => setMode("donations")} icon={<HandCoins className="size-5" aria-hidden />}
              title="תרומות" text="ייצוא ממערכת התרומות: תורם, סכום, תאריך ומספר קבלה." />
          </div>
        </fieldset>
      )}

      <Card>
        <div className="p-5">
          <label
            htmlFor="import-file"
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); chooseFile(e.dataTransfer.files?.[0] ?? null); }}
            className={cx(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-brand/30",
              drag ? "border-brand bg-brand-soft" : "border-line-strong hover:bg-canvas",
            )}
          >
            {file ? <FileSpreadsheet className="size-8 text-brand" aria-hidden /> : <Upload className="size-8 text-ink-3" aria-hidden />}
            {file ? (
              <span className="text-sm"><span className="font-medium"><bdi>{file.name}</bdi></span> <span className="text-ink-3">· {file.size < 1024 ? "פחות מ-1 KB" : `${(file.size / 1024).toLocaleString("he-IL", { maximumFractionDigits: 0 })} KB`}</span></span>
            ) : (
              <span className="text-sm font-medium">בחירת קובץ, או גרירה לכאן</span>
            )}
            <span className="text-[12px] text-ink-3">xlsx או CSV · עד 5MB · עד {IMPORT_MAX_ROWS.toLocaleString("he-IL")} שורות</span>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <ul className="mt-4 space-y-1.5 text-[13px] text-ink-2 list-disc ps-5">
            <li>מהאקסל נקרא הגיליון הראשון. שורת הכותרות מזוהה אוטומטית, גם אם יש מעליה כותרת.</li>
            <li>מגוגל שיטס: קובץ ← הורדה ← Microsoft Excel (xlsx).</li>
            <li>מוואטסאפ: אפשר להדביק את רשימת המשתתפים לגיליון עם עמודות שם וטלפון.</li>
            <li>בשלב הזה שום דבר עוד לא נשמר במערכת.</li>
          </ul>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" disabled={!file || pending} aria-busy={pending} onClick={onNext}>
          {pending ? "קורא את הקובץ…" : "המשך להתאמת העמודות"}
        </Button>
      </div>
    </>
  );
}

function ModeCard({ checked, onChange, icon, title, text }: { checked: boolean; onChange: () => void; icon: ReactNode; title: string; text: string }) {
  return (
    <label className={cx(
      "flex gap-3 rounded-[var(--radius-card)] border bg-surface p-4 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-brand/30",
      checked ? "border-brand ring-1 ring-brand" : "border-line hover:border-line-strong",
    )}>
      <input type="radio" name="import-mode" checked={checked} onChange={onChange} className="mt-1 size-4 accent-[var(--color-brand)] shrink-0" />
      <span>
        <span className="flex items-center gap-2 font-medium">{icon}{title}</span>
        <span className="block text-[13px] text-ink-3 mt-0.5">{text}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — column mapping and options
// ---------------------------------------------------------------------------

function StepMapping({ mode, parsed, mapping, setMapping, options, setOptions, types, cohorts, regions, staff, ownerLocked, pending, onBack, onNext }: {
  mode: ImportMode; parsed: ParsedFile; mapping: Mapping; setMapping: (m: Mapping) => void;
  options: ImportOptions; setOptions: (o: ImportOptions) => void;
  types: { code: string; label: string }[]; cohorts: Opt[]; regions: Opt[]; staff: { id: string; name: string }[];
  ownerLocked: boolean; pending: boolean; onBack: () => void; onNext: () => void;
}) {
  const [moved, setMoved] = useState<string | null>(null);
  const has = (f: ImportField) => mapping.includes(f);
  const requirements = mode === "contacts"
    ? [{ ok: has("first_name") || has("full_name"), label: "שם (שם פרטי או שם מלא)" }]
    : [
        { ok: has("amount"), label: "סכום" },
        { ok: has("date"), label: "תאריך התרומה" },
        { ok: has("phone") || has("email") || has("full_name") || has("first_name"), label: "זיהוי התורם/ת: טלפון, דוא״ל או שם" },
      ];
  const ready = requirements.every((r) => r.ok);
  const matchHint = has("phone") || has("email")
    ? "אנשים שכבר קיימים במערכת יזוהו לפי טלפון, ואם אין — לפי דוא״ל."
    : "לא נבחרה עמודת טלפון או דוא״ל, ולכן אי אפשר לזהות מי כבר קיים במערכת. מומלץ להוסיף אחת מהן.";

  function pick(col: number, value: string) {
    const f = (value || null) as ImportField | null;
    const next = [...mapping];
    const prev = f ? next.indexOf(f) : -1;
    if (f && prev >= 0 && prev !== col) {
      next[prev] = null;
      setMoved(`"${FIELD_LABELS[f]}" הועבר מהעמודה "${parsed.headers[prev]}" לעמודה "${parsed.headers[col]}".`);
    } else setMoved(null);
    next[col] = f;
    setMapping(next);
  }

  return (
    <>
      <p className="text-sm text-ink-2">
        נמצאו <strong className="tabular-nums">{parsed.rowCount.toLocaleString("he-IL")}</strong> שורות
        {parsed.sheetName ? <> בגיליון <bdi>&quot;{parsed.sheetName}&quot;</bdi></> : null}
        {parsed.headerRow > 1 ? <>, הכותרות בשורה {parsed.headerRow}</> : null}.
        {" "}בדקו שכל עמודה מותאמת לשדה הנכון. עמודות שלא תבחרו לא ייובאו.
      </p>

      <Card>
        <CardHeader title="התאמת עמודות" subtitle="ההצעות מבוססות על כותרות העמודות. אפשר לשנות כל אחת מהן." />
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_15rem] gap-4 px-5 pb-2 text-[12px] text-ink-3 border-b border-line">
          <span>עמודה בקובץ</span><span>דוגמאות מהקובץ</span><span>שדה במערכת</span>
        </div>
        <ul className="divide-y divide-line">
          {parsed.headers.map((h, i) => {
            const id = `map-${i}`;
            return (
              <li key={i} className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_15rem] gap-x-4 gap-y-1.5 px-5 py-3 items-center">
                <label htmlFor={id} className="font-medium text-sm truncate"><bdi>{h}</bdi></label>
                <div className="text-[13px] text-ink-3 truncate" title={parsed.samples[i]?.join(" · ")}>
                  {parsed.samples[i]?.length ? <bdi>{parsed.samples[i].join(" · ")}</bdi> : "עמודה ריקה"}
                </div>
                <Select id={id} value={mapping[i] ?? ""} onChange={(e) => pick(i, e.target.value)} className={cx(!mapping[i] && "text-ink-3")}>
                  <option value="">לא לייבא</option>
                  {MODE_FIELDS[mode].map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                </Select>
              </li>
            );
          })}
        </ul>
        <div className="px-5 py-3 border-t border-line" aria-live="polite">
          {moved && <p className="text-[13px] text-info mb-2">{moved}</p>}
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            {requirements.map((r) => (
              <li key={r.label} className={cx("flex items-center gap-1.5", r.ok ? "text-ok" : "text-ink-2")}>
                {r.ok ? <Check className="size-4" aria-hidden /> : <Circle className="size-4 text-ink-3" aria-hidden />}
                <span className="sr-only">{r.ok ? "נבחר:" : "חסר:"}</span>{r.label}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-3 mt-1.5">{matchHint}</p>
        </div>
      </Card>

      {mode === "contacts" ? (
        <Card>
          <CardHeader title="הגדרות לכל השורות" subtitle="ערכי ברירת המחדל ממלאים רק תאים ריקים. ערך שמופיע בקובץ תמיד קודם." />
          <div className="grid sm:grid-cols-2 gap-4 px-5 pb-5">
            <Field label="תגית לכל מי שבקובץ" htmlFor="opt-type" hint="למשל: כל מי שברשימת המילואים יקבל תגית לוחם/ת מילואים.">
              <Select id="opt-type" value={options.typeCode} onChange={(e) => setOptions({ ...options, typeCode: e.target.value })}>
                <option value="">ללא תגית</option>
                {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="מקור הרשימה" htmlFor="opt-source" hint="יירשם בהערות של אנשים חדשים, כדי שיהיה ברור מאיפה הגיעו.">
              <Input id="opt-source" maxLength={200} placeholder="למשל: קבוצת הוואטסאפ של מחזור 2005" value={options.sourceNote}
                onChange={(e) => setOptions({ ...options, sourceNote: e.target.value })} />
            </Field>
            <Field label="מחזור למי שאין לו מחזור בקובץ" htmlFor="opt-cohort">
              <Select id="opt-cohort" value={options.defaultCohortId ?? ""} onChange={(e) => setOptions({ ...options, defaultCohortId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">ללא</option>
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="אזור למי שאין לו אזור בקובץ" htmlFor="opt-region">
              <Select id="opt-region" value={options.defaultRegionId ?? ""} onChange={(e) => setOptions({ ...options, defaultRegionId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">ללא</option>
                {regions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            {ownerLocked ? (
              <p className="text-[13px] text-ink-3 sm:col-span-2">אנשים חדשים שתייבאו יוגדרו באחריותך, כדי שתוכלו לראות אותם אחרי הייבוא.</p>
            ) : (
              <Field label="אחראי/ת קשר" htmlFor="opt-owner" hint="יוגדר לאנשים חדשים, ולקיימים שאין להם אחראי/ת.">
                <Select id="opt-owner" value={options.defaultOwnerId ?? ""} onChange={(e) => setOptions({ ...options, defaultOwnerId: e.target.value || null })}>
                  <option value="">ללא</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
        </Card>
      ) : (
        <Notice tone="info" title="איך תרומות משויכות">
          כל תרומה משויכת לאיש קשר לפי טלפון, ואם אין — לפי דוא״ל. מי שתשויך לו תרומה יסומן בתגית &quot;תורם/ת&quot;.
          תרומה שמספר האסמכתא שלה כבר קיים במערכת לא תיובא שוב. בשלב הבא תוכלו להחליט מה לעשות עם תרומות שלא נמצא להן איש קשר.
        </Notice>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={onBack} disabled={pending}>חזרה</Button>
        <Button variant="primary" onClick={onNext} disabled={!ready || pending} aria-busy={pending}>
          {pending ? "בודק מול המערכת…" : "בדיקה — עדיין בלי לשמור"}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — preview
// ---------------------------------------------------------------------------

const n = (x: number) => x.toLocaleString("he-IL");

function StepPreview({ preview, isAdmin, pending, createCohorts, setCreateCohorts, createDonors, setCreateDonors, onBack, onCommit }: {
  preview: PreviewResult; isAdmin: boolean; pending: boolean;
  createCohorts: boolean; setCreateCohorts: (v: boolean) => void;
  createDonors: boolean; setCreateDonors: (v: boolean) => void;
  onBack: () => void; onCommit: () => void;
}) {
  const c = preview.counts;
  const contacts = preview.mode === "contacts";
  const notImported = (r: PlanRow) =>
    r.status === "error" || r.status === "duplicate" || r.status === "exists" || (r.status === "unmatched" && !createDonors);
  const skippedRows = preview.rows.filter(notImported);
  const willWrite = contacts ? c.new + preview.updatesWithChanges : c.new + (createDonors ? c.unmatched : 0);
  const filters: RowFilter[] = contacts
    ? [
        { key: "all", label: "הכול", test: () => true },
        { key: "new", label: "חדשים", test: (r) => r.status === "new" },
        { key: "update", label: "קיימים", test: (r) => r.status === "update" },
        { key: "skip", label: "לא ייובאו", test: notImported },
        { key: "warn", label: "עם אזהרות", test: (r) => r.warnings.length > 0 },
      ]
    : [
        { key: "all", label: "הכול", test: () => true },
        { key: "new", label: "ישויכו לאיש קשר קיים", test: (r) => r.status === "new" },
        { key: "unmatched", label: "ללא איש קשר", test: (r) => r.status === "unmatched" },
        { key: "skip", label: "לא ייובאו", test: notImported },
        { key: "warn", label: "עם אזהרות", test: (r) => r.warnings.length > 0 },
      ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {contacts ? (
          <>
            <Stat label="אנשים חדשים" value={n(c.new)} />
            <Stat label="כבר קיימים" value={n(c.update)} hint={`${n(preview.updatesWithChanges)} יושלמו בפרטים חסרים`} />
            <Stat label="שגיאות" value={n(c.error)} tone={c.error ? "danger" : "neutral"} hint="לא ייובאו" />
            <Stat label="כפולים בתוך הקובץ" value={n(c.duplicate)} tone={c.duplicate ? "warn" : "neutral"} hint="לא ייובאו" />
          </>
        ) : (
          <>
            <Stat label="תרומות לאנשי קשר קיימים" value={n(c.new)} />
            <Stat label="ללא איש קשר תואם" value={n(c.unmatched)} hint={`${n(preview.unmatchedDonors)} אנשים שונים`} tone={c.unmatched ? "warn" : "neutral"} />
            <Stat label="כבר יובאו בעבר" value={n(c.exists)} hint="לא ייובאו שוב" />
            <Stat label="שגיאות וכפולים" value={n(c.error + c.duplicate)} tone={c.error + c.duplicate ? "danger" : "neutral"} hint="לא ייובאו" />
          </>
        )}
      </div>

      {preview.limitedVisibility && (
        <Notice tone="info">
          הבדיקה מול רשומות קיימות כוללת רק אנשים שיש לך הרשאה לראות. אם ייווצרו כפילויות עם רשומות אחרות, הן יופיעו במסך &quot;איכות נתונים&quot; לאיחוד.
        </Notice>
      )}

      {contacts && preview.unknownCohorts.length > 0 && (
        <Notice tone="warn" title="מחזורים שלא קיימים ברשימת המחזורים">
          <p className="mt-1"><LabelList items={preview.unknownCohorts} /></p>
          {isAdmin ? (
            <div className="mt-3">
              <Checkbox label="ליצור מחזורים חדשים" hint="המחזורים יתווספו לרשימה וישויכו לאנשים. בלי הסימון, שדה המחזור יישאר ריק."
                checked={createCohorts} onChange={(e) => setCreateCohorts(e.target.checked)} />
            </div>
          ) : (
            <p className="mt-1">רק מנהל/ת מערכת יכול/ה להוסיף מחזורים. אצל האנשים האלה שדה המחזור יישאר ריק, ואפשר יהיה להשלים אותו אחר כך.</p>
          )}
        </Notice>
      )}

      {contacts && preview.unknownRegions.length > 0 && (
        <Notice tone="warn" title="אזורים שלא קיימים ברשימת האזורים">
          <p className="mt-1"><LabelList items={preview.unknownRegions} /></p>
          <p className="mt-1">שדה האזור יישאר ריק אצל האנשים האלה. אפשר לעדכן אחר כך בעדכון קבוצתי.</p>
        </Notice>
      )}

      {!contacts && preview.newCampaigns.length > 0 && (
        <Notice tone="info" title="קמפיינים חדשים שייווצרו">
          <p className="mt-1"><LabelList items={preview.newCampaigns} /></p>
        </Notice>
      )}

      {!contacts && c.unmatched > 0 && (
        <Card>
          <div className="p-5">
            <Checkbox
              label={`ליצור ${n(preview.unmatchedDonors)} אנשי קשר חדשים עם תגית תורם/ת`}
              hint="כל אדם ייווצר פעם אחת, גם אם יש לו כמה תרומות בקובץ. בלי הסימון, התרומות האלה לא ייובאו ויופיעו ברשימת השורות שלא יובאו."
              checked={createDonors}
              onChange={(e) => setCreateDonors(e.target.checked)}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="פירוט לפי שורות"
          subtitle="הסטטוס של כל שורה, והסיבה."
          action={<DownloadButton rows={skippedRows} mode={preview.mode} fileName="שורות-שלא-ייובאו.csv" label="הורדת השורות שלא ייובאו" createDonors={createDonors} />}
        />
        <RowsTable rows={preview.rows} mode={preview.mode} filters={filters} createDonors={createDonors} caption="תצוגה מקדימה של הייבוא" />
      </Card>

      <Card className="border-brand/30">
        <CardHeader title="מה יקרה כשתלחצו על ייבוא" />
        <ul className="px-5 pb-4 space-y-1.5 text-sm text-ink-2 list-disc ps-10">
          {contacts ? (
            <>
              <li>ייווצרו <strong>{n(c.new)}</strong> אנשים חדשים (מקור: ייבוא מקובץ).</li>
              <li><strong>{n(preview.updatesWithChanges)}</strong> רשומות קיימות יושלמו — רק בשדות שריקים היום. שום ערך קיים לא יוחלף.</li>
              {c.update - preview.updatesWithChanges > 0 && <li>{n(c.update - preview.updatesWithChanges)} רשומות קיימות לא ישתנו (אין בהן שדות ריקים להשלים).</li>}
            </>
          ) : (
            <>
              <li>ייווצרו <strong>{n(c.new + (createDonors ? c.unmatched : 0))}</strong> תרומות, מסומנות כייבוא מהקובץ הזה.</li>
              {createDonors && c.unmatched > 0 && <li>ייווצרו <strong>{n(preview.unmatchedDonors)}</strong> אנשי קשר חדשים עם תגית תורם/ת.</li>}
              {preview.newCampaigns.length > 0 && <li>ייווצרו {n(preview.newCampaigns.length)} קמפיינים חדשים.</li>}
            </>
          )}
          <li><strong>{n(skippedRows.length)}</strong> שורות לא ייובאו. כולן מופיעות ברשימה עם הסיבה, וזמינות להורדה.</li>
          <li>הייבוא יירשם ביומן הייבואים עם סיכום מלא.</li>
        </ul>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={onBack} disabled={pending}>חזרה להתאמת העמודות</Button>
        <Button variant="primary" onClick={onCommit} disabled={pending || willWrite === 0} aria-busy={pending}>
          {pending ? "מייבא… זה עשוי לקחת דקה" : willWrite === 0 ? "אין מה לייבא" : "ייבוא עכשיו"}
        </Button>
      </div>
    </>
  );
}

function LabelList({ items }: { items: { label: string; rows: number }[] }) {
  return (
    <>
      {items.slice(0, 20).map((x, i) => (
        <span key={x.label}>
          {i > 0 && ", "}
          <bdi>&quot;{x.label}&quot;</bdi> <span className="text-ink-3 tabular-nums">({n(x.rows)} שורות)</span>
        </span>
      ))}
      {items.length > 20 && <span> ועוד {n(items.length - 20)}</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — result
// ---------------------------------------------------------------------------

function StepResult({ result, fileName, createDonors, onRestart }: { result: CommitResult; fileName: string; createDonors: boolean; onRestart: () => void }) {
  const contacts = result.mode === "contacts";
  const base = fileName.replace(/\.[^.]+$/, "");
  return (
    <>
      <Notice tone="ok" title="הנתונים נשמרו">
        {contacts
          ? `נוספו ${n(result.created)} אנשים חדשים, ${n(result.updated)} רשומות קיימות הושלמו ו-${n(result.unchanged)} לא נדרשו לשינוי.`
          : `נוספו ${n(result.donationsCreated)} תרומות${result.donorsCreated ? ` ו-${n(result.donorsCreated)} אנשי קשר חדשים` : ""}.`}
        {result.skipped > 0 && ` ${n(result.skipped)} שורות לא יובאו — הרשימה למטה.`}
      </Notice>
      {result.partialError && <Notice tone="warn" title="חלק מהפעולות לא הושלמו">{result.partialError}</Notice>}
      {(result.cohortsCreated.length > 0 || result.campaignsCreated.length > 0) && (
        <Notice tone="info">
          {result.cohortsCreated.length > 0 && <p>נוספו מחזורים: <bdi>{result.cohortsCreated.join(", ")}</bdi></p>}
          {result.campaignsCreated.length > 0 && <p>נוספו קמפיינים: <bdi>{result.campaignsCreated.join(", ")}</bdi></p>}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        {result.listHref && <LinkButton href={result.listHref} variant="primary">לרשומות שיובאו</LinkButton>}
        <LinkButton href="/contacts/quality">בדיקת כפילויות</LinkButton>
        <Button onClick={onRestart}>ייבוא קובץ נוסף</Button>
      </div>

      {result.touched.length > 0 && (
        <Card>
          <details>
            <summary className="cursor-pointer px-5 py-4 text-[15px] font-semibold">
              רשומות שנוצרו או הושלמו <span className="text-ink-3 font-normal text-sm">({result.touched.length < 100 ? n(result.touched.length) : "100 הראשונות"})</span>
            </summary>
            <ul className="border-t border-line divide-y divide-line">
              {result.touched.map((t) => (
                <li key={t.id + t.kind} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <Link href={`/contacts/${t.id}`} className="font-medium hover:text-brand hover:underline">{t.name || "ללא שם"}</Link>
                  <span className="text-[12px] text-ink-3">{t.kind === "created" ? "נוצר/ה" : "הושלם/ה"}</span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {result.skippedRows.length > 0 && (
        <Card>
          <CardHeader
            title="שורות שלא יובאו"
            subtitle="אפשר לתקן אותן בקובץ ולייבא שוב — שורות שכבר יובאו יזוהו ולא ייכפלו."
            action={<DownloadButton rows={result.skippedRows} mode={result.mode} fileName={`${base}-שורות-שלא-יובאו.csv`} label="הורדה כ-CSV" createDonors={createDonors} />}
          />
          <RowsTable rows={result.skippedRows} mode={result.mode} filters={[{ key: "all", label: "הכול", test: () => true }]} createDonors={createDonors} caption="שורות שלא יובאו" />
        </Card>
      )}
      <p className="text-[12px] text-ink-3">
        מספר ייבוא לתיעוד: <span dir="ltr" className="font-mono">{result.batchId.slice(0, 8)}</span>.{" "}
        <Link href="/contacts" className={buttonClass("quiet", "sm", "px-1 h-auto")}>לרשימת האנשים</Link>
      </p>
    </>
  );
}

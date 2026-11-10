"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "./index";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}
export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant = "primary", size, pendingText = "שומר…", className }: {
  children: ReactNode; variant?: "primary" | "secondary" | "danger" | "quiet"; size?: "sm" | "md"; pendingText?: string; className?: string;
}) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? pendingText : children}
    </button>
  );
}

const PendingContext = createContext(false);
const ModalCloseContext = createContext<(() => void) | null>(null);

/** Close the surrounding <Modal>, if any. */
export function useModalClose() {
  return useContext(ModalCloseContext);
}

/**
 * A form bound to a server action, showing success / error messages inline.
 * Submits via onSubmit (not <form action>) so React 19 does not clear what the user typed
 * when the server answers with a validation error. Inside a <Modal> it closes on success.
 */
export function ActionForm({ action, children, className, onSuccess, resetOnSuccess = false, closeOnSuccess = true, id }: {
  action: FormAction; children: ReactNode | ((state: ActionState) => ReactNode); className?: string;
  onSuccess?: (s: ActionState) => void; resetOnSuccess?: boolean; closeOnSuccess?: boolean; id?: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const closeModal = useContext(ModalCloseContext);
  const succeeded = useEffectEvent((s: ActionState) => {
    if (resetOnSuccess) ref.current?.reset();
    onSuccess?.(s);
    if (closeOnSuccess && closeModal) closeModal();
  });
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.ok) succeeded(state);
    else if (state.error) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.append(submitter.name, submitter.value);
    startTransition(() => dispatch(fd));
  }
  return (
    <PendingContext.Provider value={pending}>
      <form ref={ref} onSubmit={onSubmit} className={className} id={id} aria-busy={pending}>
        {typeof children === "function" ? children(state) : children}
        {state.error && <p ref={errorRef} role="alert" className="text-sm text-danger mt-3">{state.error}</p>}
        {state.ok && state.message && <p role="status" className="text-sm text-ok mt-3">{state.message}</p>}
      </form>
    </PendingContext.Provider>
  );
}

/** Modal built on the native <dialog> (focus trap, Esc to close, accessible by default). */
export function Modal({ trigger, title, children, triggerClassName, triggerVariant = "secondary", triggerSize, wide }: {
  trigger: ReactNode; title: string; children: ReactNode | ((close: () => void) => ReactNode); triggerClassName?: string;
  triggerVariant?: "primary" | "secondary" | "ghost" | "quiet" | "danger"; triggerSize?: "sm" | "md"; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" className={triggerClassName ?? buttonClass(triggerVariant, triggerSize)} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-label={title}
        className={cx("m-auto w-[calc(100%-2rem)] rounded-[var(--radius-card)] bg-surface p-0 text-ink shadow-xl", wide ? "max-w-2xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={close} className={buttonClass("ghost", "sm")} aria-label="סגירה">✕</button>
        </div>
        <div className="px-5 py-4 max-h-[75vh] overflow-y-auto">
          <ModalCloseContext.Provider value={close}>{open && (typeof children === "function" ? children(close) : children)}</ModalCloseContext.Provider>
        </div>
      </dialog>
    </>
  );
}

/** Button that asks for confirmation before running a destructive server action. */
export function ConfirmSubmit({ children, message, variant = "danger", size = "sm" }: { children: ReactNode; message: string; variant?: "danger" | "secondary"; size?: "sm" | "md" }) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, size)}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
    >
      {pending ? "רגע…" : children}
    </button>
  );
}

export function CopyButton({ text, label = "העתקה", copiedLabel = "הועתק" }: { text: string; label?: string; copiedLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}
    >
      <span aria-live="polite">{done ? copiedLabel : label}</span>
    </button>
  );
}

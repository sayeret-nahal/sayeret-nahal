"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, type FormEvent, type ReactNode } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Like useActionState, but submits via onSubmit so React does NOT clear the fields
 * when the server answers with a validation error (React resets <form action> forms
 * after every completed action). The form is reset only on success, when asked to.
 */
export function useKeepValuesAction<S extends object>(action: (prev: S, fd: FormData) => Promise<S>, initial: S) {
  const [state, dispatch, pending] = useActionState<S, FormData>(
    action as (prev: Awaited<S>, fd: FormData) => Promise<S>,
    initial as Awaited<S>,
  );
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return [state as S, onSubmit, pending] as const;
}

export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Form bound to a server action that keeps what the user typed when the server returns an error. */
export function KeepForm({ action, children, className, resetOnSuccess = false, onSuccess, id, ariaLabel }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: (state: FormState, pending: boolean) => ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (s: FormState) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const [state, onSubmit, pending] = useKeepValuesAction(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  const succeeded = useEffectEvent((s: FormState) => {
    if (resetOnSuccess) ref.current?.reset();
    onSuccess?.(s);
  });
  useEffect(() => {
    if (state.ok) succeeded(state);
  }, [state]);
  return (
    <form ref={ref} onSubmit={onSubmit} className={className} id={id} aria-label={ariaLabel} aria-busy={pending}>
      {children(state, pending)}
      {state.error && <p role="alert" className="text-sm text-danger mt-3">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-ok mt-3">{state.message}</p>}
    </form>
  );
}

export function PendingButton({ pending, children, pendingText = "שומר…", variant = "primary", size, className }: {
  pending: boolean; children: ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "danger" | "quiet"; size?: "sm" | "md"; className?: string;
}) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? pendingText : children}
    </button>
  );
}

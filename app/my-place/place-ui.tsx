"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import type { CurrentWorkspaceOption } from "@/lib/current-context";

export const button =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#eadfd7] bg-white px-3.5 text-sm font-semibold text-[#302a28] transition hover:bg-[#fff5ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f26f3d] disabled:cursor-wait disabled:opacity-50";
export const primaryButton = `${button} !border-[#f26f3d] !bg-[#f26f3d] !text-white hover:!bg-[#dc5c2c]`;
export const inputClass =
  "min-h-11 w-full rounded-xl border border-[#e5ddd7] bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#f26f3d] focus:ring-2 focus:ring-[#fff0e8] disabled:bg-zinc-50";

// Keep entered values after a rejected action and include the clicked submit button.
export function readForm(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(
    event.currentTarget,
    (event.nativeEvent as SubmitEvent).submitter,
  );
}

export function Field({
  label,
  name,
  value,
  required,
  type = "text",
  maxLength = 200,
}: {
  label: string;
  name: string;
  value?: string | null;
  required?: boolean;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
      <span>
        <WorkspaceText text={label} />
        {required ? " *" : ""}
      </span>
      <input
        className={inputClass}
        defaultValue={value ?? ""}
        maxLength={maxLength}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

export function Notice({
  error,
  children,
}: {
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-800"}`}
    >
      {children}
    </p>
  );
}

export function Avatar({ workspace }: { workspace: CurrentWorkspaceOption }) {
  const __vt = useWorkspaceTranslation();

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#eee5df] bg-[#fff0e8] text-sm font-bold text-[#ad542d]">
      {workspace.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={__vt("")}
          className="h-full w-full object-cover"
          src={workspace.avatarUrl}
        />
      ) : (
        workspace.label.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

export function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-4 pt-2 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-600">
          <WorkspaceText text={title} />
          <span className="text-xs font-normal text-zinc-500">
            {count}
          </span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Sheet({
  title,
  subtitle,
  busy,
  dirty,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  busy: boolean;
  dirty: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const __vt = useWorkspaceTranslation();

  const ref = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function close() {
    if (busy) return;
    if (!dirty || window.confirm(__vt("Discard your unsaved changes?"))) onClose();
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        backdropPointer.current =
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom);
      }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (
          backdropPointer.current &&
          event.target === event.currentTarget &&
          outside
        )
          close();
        backdropPointer.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-xl border-0 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/35 backdrop:backdrop-blur-[2px]"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#eee5df] bg-white px-5 py-4">
        <div>
          <h2 id={titleId} className="text-lg font-bold">
            <WorkspaceText text={title} />
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-zinc-500"><WorkspaceText text={subtitle} /></p>
          ) : null}
        </div>
        <button
          aria-label={__vt("Close panel")}
          className={button}
          disabled={busy}
          onClick={close}
          type="button"
        >
          ✕
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

export function FormFooter({
  busy,
  label = "Save changes",
}: {
  busy: boolean;
  label?: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-5 border-t border-[#eee5df] bg-white px-5 pb-1 pt-4">
      <button
        className={`${primaryButton} w-full`}
        disabled={busy}
        type="submit"
      >
        <WorkspaceText text={busy ? "Saving…" : label} />
      </button>
    </div>
  );
}

export function LoadState({
  error,
  retry,
}: {
  error?: string;
  retry: () => void;
}) {
  return error ? (
    <Notice error>
      <WorkspaceText text={error} />{" "}
      <button className="ml-2 underline" onClick={retry}>
        <WorkspaceText text="Retry" />
      </button>
    </Notice>
  ) : (
    <p role="status" className="py-4 text-sm text-zinc-500">
      <WorkspaceText text="Loading details…" />
    </p>
  );
}

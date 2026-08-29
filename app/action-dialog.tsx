"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type ActionDialogAction = {
  href?: string;
  label: string;
  onClick?: () => void;
};

type ActionDialogProps = {
  description: ReactNode;
  onClose: () => void;
  open: boolean;
  primaryAction?: ActionDialogAction;
  secondaryAction?: ActionDialogAction;
  title: string;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function runButtonAction(action: ActionDialogAction | undefined, onClose: () => void) {
  action?.onClick?.();
  onClose();
}

function DialogAction({
  action,
  onClose,
  variant,
}: {
  action: ActionDialogAction;
  onClose: () => void;
  variant: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? "inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      : "inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950";

  if (action.href) {
    return (
      <Link className={className} href={action.href} onClick={onClose}>
        {action.label}
      </Link>
    );
  }

  return (
    <button
      className={className}
      onClick={() => runButtonAction(action, onClose)}
      type="button"
    >
      {action.label}
    </button>
  );
}

export function ActionDialog({
  description,
  onClose,
  open,
  primaryAction,
  secondaryAction,
  title,
}: ActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  function focusableElements() {
    return Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => !element.hasAttribute("disabled"));
  }

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = focusableElements();

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-zinc-950/40 px-4 py-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="grid w-full max-w-md gap-4 rounded-lg bg-white p-5 text-zinc-950 shadow-2xl"
        onKeyDown={onDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold" id={titleId}>
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600" id={descriptionId}>
              {description}
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {secondaryAction ? (
            <DialogAction
              action={secondaryAction}
              onClose={onClose}
              variant="secondary"
            />
          ) : null}
          {primaryAction ? (
            <DialogAction
              action={primaryAction}
              onClose={onClose}
              variant="primary"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

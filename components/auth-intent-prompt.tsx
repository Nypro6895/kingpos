"use client";

import { ReylumiIcon } from "@/components/reylumi-icons";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./auth-intent-prompt.module.css";

type AuthIntentPromptProps = {
  children: ReactNode;
  guestHref?: string;
  guestLabel?: string;
  kicker: string;
  onClose: () => void;
  primaryLabel?: string;
  showProviderOptions?: boolean;
  title: string;
};

function authHrefForCurrentPage(kind: "login" | "signup") {
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  return `/${kind}?next=${encodeURIComponent(returnPath || "/explore")}`;
}

export function AuthIntentPrompt({
  children,
  guestHref,
  guestLabel = "Continue as guest",
  kicker,
  onClose,
  primaryLabel = "Create account",
  showProviderOptions = false,
  title,
}: AuthIntentPromptProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const signupHref = authHrefForCurrentPage("signup");
  const loginHref = authHrefForCurrentPage("login");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === 'Tab') {
        const elements=dialogRef.current?.querySelectorAll<HTMLElement>('a,button');
        if(!elements?.length)return;
        const first=elements[0],last=elements[elements.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      opener?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <div aria-hidden className="flex justify-center"><span className={styles.heart}>♡</span></div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase text-brand-orange">
              {kicker}
            </p>
            <h2 className="mt-1 text-xl font-semibold" id={titleId}>
              {title}
            </h2>
          </div>
          <button
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-text-secondary transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={onClose}
            type="button"
          >
            <ReylumiIcon className="h-4 w-4" name="close" />
          </button>
        </div>
        <div className="text-sm leading-6 text-text-secondary">{children}</div>
        {guestHref ? (
          <div className="grid gap-3">
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-[0.75rem] bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              href={guestHref}
            >
              {guestLabel}
            </Link>
            {showProviderOptions ? (
              <>
                <div className="flex items-center gap-3 text-center text-xs font-semibold text-text-muted">
                  <span className="h-px flex-1 bg-divider-subtle" />
                  or
                  <span className="h-px flex-1 bg-divider-subtle" />
                </div>
                <Link
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.75rem] bg-white px-5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href={loginHref}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-sm font-black text-brand-orange ring-1 ring-divider-subtle">
                    G
                  </span>
                  Continue with Google
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.75rem] bg-white px-5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href={loginHref}
                >
                  <span
                    aria-hidden
                    className="h-5 w-5 rounded-full bg-text-primary"
                  />
                  Continue with Apple
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.75rem] bg-white px-5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href={loginHref}
                >
                  <ReylumiIcon className="h-4 w-4" name="message" />
                  Continue with email
                </Link>
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-orange px-5 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={signupHref}
            >
              {primaryLabel}
            </Link>
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface-muted px-5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={loginHref}
            >
              Login
            </Link>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

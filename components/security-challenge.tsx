"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";

type Challenge = { id: string; image: string };
export type SecurityChallengeHandle = { verify: () => Promise<void> };

class SecurityResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readResult(response: Response) {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Unable to complete the security check. Please try again.");
  }
  const result = await response.json();
  if (!response.ok) {
    throw new SecurityResponseError(typeof result?.error === "string" ? result.error : "Unable to complete the security check. Please try again.", response.status);
  }
  return result;
}

/** A fieldset, so the same check works inside signup or its own form. */
export function SecurityChallenge({
  onVerified,
  submitLabel = "Verify",
  disabled = false,
  ref,
}: {
  onVerified: () => void | Promise<void>;
  submitLabel?: string;
  disabled?: boolean;
  ref?: Ref<SecurityChallengeHandle>;
}) {
  const id = useId();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  const [answerError, setAnswerError] = useState(false);
  const [pending, setPending] = useState<"loading" | "verifying" | null>("loading");
  const [enlarged, setEnlarged] = useState(false);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const verified = useRef(false);
  const mounted = useRef(true);
  const region = useRef<HTMLFieldSetElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    verified.current = false;
    try {
      const response = await fetch("/api/security/challenge", { cache: "no-store", signal: controller.signal });
      const result = await readResult(response);
      if (typeof result?.id !== "string" || typeof result?.image !== "string" || !result.image.startsWith("data:image/png;base64,")) {
        throw new Error("Unable to load the security image. Please get a new image.");
      }
      if (!controller.signal.aborted && mounted.current) setChallenge({ id: result.id, image: result.image });
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setNotice(error instanceof Error ? error.message : "Unable to load the security image. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) {
        busy.current = false;
        setPending(null);
      }
    }
  }, []);

  const resetAndLoad = useCallback(() => {
    // Clear the old image immediately: its answer must never verify a new ID.
    setChallenge(null);
    setAnswer("");
    setNotice("");
    setAnswerError(false);
    setPending("loading");
    void load();
  }, [load]);

  function refresh() {
    if (!busy.current && !disabled) resetAndLoad();
  }

  useEffect(() => {
    let active = true;
    mounted.current = true;
    region.current?.focus();
    // Defer the initial request until mounted; Strict Mode cleanup can cancel it.
    queueMicrotask(() => { if (active) resetAndLoad(); });
    return () => {
      active = false;
      mounted.current = false;
      request.current?.abort();
      busy.current = false;
      verified.current = false;
    };
  }, [resetAndLoad]);

  async function verify() {
    if (busy.current || verified.current || disabled || !challenge) return;
    if (!/^[a-z0-9]{6}$/i.test(answer.trim())) {
      setNotice("Enter all six letters and numbers shown in the image.");
      setAnswerError(true);
      input.current?.focus();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    setPending("verifying");
    setNotice("");
    setAnswerError(false);
    try {
      const response = await fetch("/api/security/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: challenge.id, answer: answer.trim() }),
        signal: controller.signal,
      });
      const result = await readResult(response);
      if (result?.ok !== true) throw new Error("Unable to verify. Please try again.");
      if (controller.signal.aborted || !mounted.current) return;
      verified.current = true;
      await onVerified();
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setNotice(error instanceof Error ? error.message : "Unable to verify. Please check your connection and try again.");
        setAnswerError(error instanceof SecurityResponseError && error.status === 400);
        input.current?.focus();
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) {
        busy.current = false;
        setPending(null);
      }
    }
  }

  useImperativeHandle(ref, () => ({ verify }));

  return (
    <fieldset
      ref={region}
      tabIndex={-1}
      aria-busy={Boolean(pending)}
      aria-describedby={`${id}-help`}
      className="min-w-0 space-y-3 rounded-2xl border border-border-subtle bg-surface-muted/50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-orange"
    >
      <legend className="px-1 text-sm font-extrabold text-text-primary">Quick security check</legend>
      <p id={`${id}-help`} className="text-sm leading-5 text-text-secondary">
        Help us prevent spam. Enter the six letters and numbers below. Uppercase or lowercase both work.
      </p>
      {pending === "loading" ? <p role="status" className="py-5 text-sm text-text-secondary">Loading security image…</p> : null}
      {challenge ? (
        <>
          <div
            id={`${id}-image`}
            className="max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-white"
            tabIndex={enlarged ? 0 : undefined}
            role={enlarged ? "region" : undefined}
            aria-label={enlarged ? "Enlarged security image. Scroll horizontally to see all six characters." : undefined}
          >
            {/* The answer is only in server-generated pixels, never image alt text. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={challenge.image}
              width={360}
              height={96}
              alt="Security image containing six letters and numbers"
              className={enlarged ? "block h-auto w-[540px] max-w-none" : "mx-auto block h-auto w-full max-w-[360px]"}
              onError={() => {
                setChallenge(null);
                setNotice("The security image could not be displayed. Please get a new image.");
              }}
            />
          </div>
          <button
            aria-controls={`${id}-image`}
            aria-expanded={enlarged}
            className="min-h-11 text-sm font-semibold text-text-primary underline underline-offset-4"
            onClick={() => setEnlarged(value => !value)}
            type="button"
          >
            {enlarged ? "Show full image" : "Enlarge image"}
          </button>
          {enlarged ? <p className="text-xs leading-5 text-text-secondary">Swipe or scroll the image sideways to see all six characters.</p> : null}
        </>
      ) : null}
      <label className="block text-sm font-extrabold text-text-primary" htmlFor={`${id}-answer`}>Characters in the image</label>
      <input
        ref={input}
        id={`${id}-answer`}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={6}
        value={answer}
        aria-invalid={answerError || undefined}
        aria-describedby={`${id}-help${notice ? ` ${id}-notice` : ""}`}
        disabled={Boolean(pending) || disabled || !challenge}
        onChange={event => { setAnswer(event.target.value); setAnswerError(false); }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); void verify(); }
        }}
        className="min-h-[52px] w-full min-w-0 rounded-xl border border-border-subtle bg-white px-3 text-base font-semibold tracking-widest text-text-primary outline-none focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 disabled:opacity-60"
      />
      {notice ? <p id={`${id}-notice`} role="alert" className="text-sm leading-5 text-red-800">{notice}</p> : null}
      <button
        type="button"
        disabled={Boolean(pending) || disabled || !challenge}
        aria-busy={pending === "verifying" || disabled}
        onClick={() => void verify()}
        className="min-h-[52px] w-full rounded-2xl bg-brand-orange px-3 py-3 text-sm font-extrabold text-white hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
      >
        {pending === "verifying" ? "Verifying…" : disabled ? "Creating…" : submitLabel}
      </button>
      <button type="button" disabled={Boolean(pending) || disabled} onClick={refresh} className="min-h-11 text-sm font-semibold text-text-primary underline underline-offset-4 disabled:opacity-60">
        {challenge ? "Get a new image" : "Try loading a new image"}
      </button>
      <Link href="/contact-support" className="block text-xs leading-5 text-text-secondary underline underline-offset-4">Need help? Contact support</Link>
    </fieldset>
  );
}

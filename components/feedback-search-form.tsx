"use client";

import Form from "next/form";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useLayoutEffect, useRef, useState, useTransition, type ComponentProps } from "react";
import { ActionFeedback } from "@/components/action-feedback";
import { NavigationProgress } from "@/components/feedback-link";
import { WorkspaceText } from "@/components/workspace-language";

const SearchPendingContext = createContext(false);
type SearchFormProps = Omit<ComponentProps<typeof Form>, "action"> & { action: string; actionByPath?: { prefix: string; action: string } };

/** Keep Next Form's prefetch and no-JavaScript GET while owning its transition. */
export function FeedbackSearchForm({ children, onSubmit, replace, scroll, actionByPath, ...props }: SearchFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const action = actionByPath && (pathname === actionByPath.prefix || pathname?.startsWith(actionByPath.prefix + "/")) ? actionByPath.action : props.action;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);
  // The attempt also commits a fast/cached navigation, where pending may never
  // paint. Release on completion, errors, and retained-view effect cleanup.
  useLayoutEffect(() => { if (!pending) submitting.current = false; }, [pending, attempt]);
  useLayoutEffect(() => () => { submitting.current = false; }, []);

  return <Form {...props} action={action} replace={replace} scroll={scroll} aria-busy={pending || props["aria-busy"] || false} onSubmit={event => {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    const form = event.currentTarget;
    const submitted = (event.nativeEvent as SubmitEvent).submitter;
    const submitter = submitted instanceof HTMLButtonElement || submitted instanceof HTMLInputElement ? submitted : null;
    const method = submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get";
    const encoding = submitter?.getAttribute("formenctype") ?? form.enctype;
    const target = submitter?.getAttribute("formtarget") ?? form.target;
    const name = submitter?.getAttribute("name") ?? "";
    // Leave server/client actions and unsupported submitter overrides to Next's
    // native fallback. The wrapper never turns a mutation into navigation.
    if (method.toLowerCase() !== "get" || encoding !== "application/x-www-form-urlencoded" || (target && target !== "_self")
      || name.startsWith("$ACTION_ID_") || name.startsWith("$ACTION_REF_")) return;
    const submittedAction = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? action;
    let destination: URL;
    try { destination = new URL(submittedAction, window.location.href); }
    catch { return; }
    if (!/^https?:$/.test(destination.protocol) || destination.origin !== window.location.origin) return;
    if (submitting.current) { event.preventDefault(); return; }
    // Read successful controls, including the actual submitter, before pending
    // disables any button. Native GET replaces the action URL's query string.
    const data = new FormData(form, submitter);
    destination.search = "";
    for (const [key, value] of data) destination.searchParams.append(key, typeof value === "string" ? value : value.name);
    event.preventDefault();
    submitting.current = true;
    setAttempt(value => value + 1);
    setError("");
    startTransition(() => {
      try { router[replace ? "replace" : "push"](destination.href, { scroll }); }
      catch { setError("This view could not open. Please try again."); }
    });
  }}>
    <SearchPendingContext.Provider value={pending}>{children}</SearchPendingContext.Provider>
    <NavigationProgress pending={pending} />
    {error ? <p role="alert"><WorkspaceText text={error} /></p> : null}
  </Form>;
}

export function SearchSubmitButton({ children, disabled, pendingLabel = "Searching…", ...props }: ComponentProps<"button"> & { pendingLabel?: string }) {
  const pending = useContext(SearchPendingContext);
  return <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending || props["aria-busy"] || false}>
    <ActionFeedback pending={pending} pendingLabel={pendingLabel}>{children}</ActionFeedback>
  </button>;
}

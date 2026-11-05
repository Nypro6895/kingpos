"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useDeveloperPanel, useDeveloperLanguage, DeveloperText } from "./sections";
import { platformAction, type ActionState } from "./actions";
import { developerPanelHref } from "@/lib/market-platform/developer-navigation";
const initial: ActionState = { ok: false, message: "" };
export function PlatformForm({ children, operation, label, danger = false, confirmation, onCredential }: { children?: ReactNode; operation: string; label: string; danger?: boolean; confirmation?: string; onCredential?:()=>void }) {
  const [state, action, pending] = useActionState(platformAction, initial);
  const panel = useDeveloperPanel();
  const language = useDeveloperLanguage();
  const submittedPanel = useRef(panel);
  useEffect(()=>{if(state.token)onCredential?.();},[state.token,onCredential]);
  useEffect(() => { if (state.ok && !state.token && !state.url && !state.launchUrl && panel === submittedPanel.current) window.location.assign(developerPanelHref(submittedPanel.current, language, true)); }, [state, panel, language]);
  const locked = Boolean(pending || state.uncertain || state.token);
  return <form action={action} data-operation={operation} data-danger={danger || undefined} aria-busy={pending} onSubmit={event => { if (locked) { event.preventDefault(); return; } submittedPanel.current = panel; }}>
    <input type="hidden" name="operation" value={operation} />
    <fieldset disabled={locked} style={{border:0,padding:0,margin:0,display:"contents"}}>{children}</fieldset>
    {confirmation && <label><input type="checkbox" required disabled={locked} /><DeveloperText text={confirmation} /></label>}
    <button disabled={locked}><DeveloperText text={pending ? "Saving…" : label} /></button>
    {state.message && <p role={state.ok ? "status" : "alert"}><DeveloperText text={state.message} /></p>}
    {state.uncertain && <button type="button" onClick={() => window.location.assign(developerPanelHref(submittedPanel.current, language))}><DeveloperText text="Reload workspace to check the result" /></button>}
    {state.token && <p><code style={{ overflowWrap: "anywhere" }}>{state.token}</code></p>}
    {state.token && <button type="button" onClick={() => window.location.assign(developerPanelHref(submittedPanel.current, language))}><DeveloperText text="Refresh status after saving this credential" /></button>}
    {state.refreshToken && <p><DeveloperText text="Server refresh token (store securely, never in a URL):" /> <code style={{ overflowWrap: "anywhere" }}>{state.refreshToken}</code></p>}
    {state.url && <a href={state.url}><DeveloperText text="Continue to Stripe test mode" /></a>}
    {state.launchUrl && <a href={state.launchUrl}><DeveloperText text="Open app with synthetic connection" /></a>}
  </form>;
}

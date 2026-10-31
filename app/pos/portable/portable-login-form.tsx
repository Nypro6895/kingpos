"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { SubmitButton } from "@/components/submit-button";
import { useActionState } from "react";
import { PortableTouchKeyboard } from "./touch-keyboard";
import { PortableFullscreenButton } from "./portable-fullscreen-button";
import "./device-input-settings.css";
import {
  forgetPortablePosAccessIdAction,
  signInPortablePosAction,
  type PortablePosLoginState,
} from "@/app/pos/portable/actions";

const initialState: PortablePosLoginState = {
  error: null,
};

export function PortablePosLoginForm({
  rememberedAccessId,
  returnTo = "/pos/portable",
  submitLabel = "Open POS",
}: {
  rememberedAccessId: string;
  returnTo?: "/pos/customer-display" | "/pos/portable";
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(
    signInPortablePosAction,
    initialState,
  );
  const hasRememberedId = Boolean(rememberedAccessId);

  return (
    <div className="w-full max-w-sm" data-portable-login-shell>
      <PortableFullscreenButton cornerExit />
      <PortableTouchKeyboard scopeSelector="[data-portable-login-shell]" />
      <form
        action={formAction}
        className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
      >
        {state.error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            <WorkspaceText text={state.error} />
          </p>
        ) : null}

        {hasRememberedId ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              <WorkspaceText text="Saved POS ID" />
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-950">
              {rememberedAccessId}
            </p>
            <input name="access_id" type="hidden" value={rememberedAccessId} />
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="POS ID" /></span>
            <input
              autoComplete="username"
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none focus:border-zinc-950"
              name="access_id"
              required
            />
          </label>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Passcode" /></span>
          <input
            autoComplete="current-password"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none focus:border-zinc-950"
            name="passcode"
            required
            type="password"
          />
        </label>

        {!hasRememberedId ? (
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              className="size-4 rounded border-zinc-300"
              defaultChecked
              name="remember_id"
              type="checkbox"
            />
            <WorkspaceText text="Save POS ID" />
          </label>
        ) : (
          <input name="remember_id" type="hidden" value="on" />
        )}
        <input name="return_to" type="hidden" value={returnTo} />

        <button
          className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={pending}
          type="submit"
        >
          <WorkspaceText text={pending ? "Opening" : submitLabel} />
        </button>
      </form>

      {hasRememberedId ? (
        <form action={forgetPortablePosAccessIdAction} className="mt-3 text-center">
          <SubmitButton pendingLabel="Opening…"
            className="text-sm font-semibold text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline"
            type="submit"
          >
            <WorkspaceText text="Use different POS ID" />
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

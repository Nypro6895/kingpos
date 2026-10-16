"use client";
import { getAppLocalHost, appLocalPath } from "./app-local-host";
import { encodeAppLocalValue } from "./app-local-command-codec";
import { handlesAppLocalFileCommand } from "./app-local-upload-client";

let currentScope: string | undefined;
export function setAppLocalCommandScope(scope: string | undefined) { currentScope = scope; }
export function getAppLocalCommandScope() { return currentScope; }
export async function invokeAppLocalCommand(name: string, values: unknown[], invalidate = true) {
  if (!currentScope) throw new Error("Connect to verify your account before saving.");
  const scope = currentScope;
  const upload=await handlesAppLocalFileCommand(name,values,scope);
  const result = upload.handled ? upload : await getAppLocalHost().command<{ value?: unknown; redirect?: string }>(name, { values: await encodeAppLocalValue(values) }, { scope });
  if (scope !== currentScope) throw new Error("Your account has changed. Please open the page again.");
  if (result.redirect) window.dispatchEvent(new CustomEvent("reylumi:app-local-navigate", { detail: { path: appLocalPath(result.redirect) } }));
  if (invalidate) window.dispatchEvent(new CustomEvent("reylumi:app-local-command-complete", { detail: { scope } }));
  return result.value;
}

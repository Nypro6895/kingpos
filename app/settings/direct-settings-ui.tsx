"use client";
import { useRef, useState, type ReactNode } from "react";
import type { loadDirectSettings } from "./direct-settings-actions";
export type DirectData = Awaited<ReturnType<typeof loadDirectSettings>>;
export type ActionResult =
  | { ok: true; message?: string; inviteUrl?: string | null }
  | { ok: false; error?: string };
export const inputClass =
  "min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm";
export const buttonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50";
export function Field({
  name,
  label,
  value,
  type = "text",
  required = false,
  min,
  max,
  step,
}: {
  name: string;
  label: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        name={name}
        className={inputClass}
        defaultValue={value ?? ""}
        type={type}
        required={required}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}
export function Check({
  name,
  label,
  checked = false,
  required = false,
}: {
  name: string;
  label: string;
  checked?: boolean;
  required?: boolean;
}) {
  return (
    <label className="flex min-h-10 items-start gap-2 py-2 text-sm">
      <input
        className="mt-1 size-4 shrink-0"
        name={name}
        type="checkbox"
        defaultChecked={checked}
        required={required}
      />
      <span>{label}</span>
    </label>
  );
}
export function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <select className={inputClass} name={name} defaultValue={value}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function InlineForm({
  children,
  save,
  onSaved,
  onCancel,
  label = "Save changes",
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  save: (form: FormData) => Promise<ActionResult>;
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
  label?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [inviteUrl, setInviteUrl] = useState("");
  const lock = useRef(false),
    formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current || disabled) return;
        lock.current = true;
        setBusy(true);
        setError("");
        setMessage("");
        setInviteUrl("");
        const form = new FormData(event.currentTarget);
        try {
          const result = await save(form);
          if (!result.ok) {
            setError(
              result.error ?? "Could not save. Your changes are still here.",
            );
            return;
          }
          setMessage(result.message ?? "Saved.");
          setInviteUrl(
            result.inviteUrl
              ? new URL(result.inviteUrl, window.location.origin).toString()
              : "",
          );
          try {
            await onSaved();
          } catch {
            setError(
              "Saved, but this panel could not refresh. Reload it to see the latest values.",
            );
          }
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Could not save. Your changes are still here.",
          );
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      {inviteUrl && (
        <label className="grid gap-1 text-sm">
          Invitation link
          <input
            className={inputClass}
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      )}
      <div className="flex gap-2">
        <button
          disabled={busy || disabled}
          className={`${buttonClass} ${danger ? "!border-red-700 !bg-red-700" : "!border-zinc-950 !bg-zinc-950"} !text-white`}
        >
          {busy ? "Processing…" : label}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy || disabled}
          onClick={() => {
            formRef.current?.reset();
            onCancel?.();
            setInviteUrl("");
            setError("");
            setMessage("");
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
export const text = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
export const number = (form: FormData, key: string) => Number(text(form, key));
export const checked = (form: FormData, key: string) => form.get(key) === "on";

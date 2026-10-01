"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CurrentWorkspaceOption as Workspace } from "@/lib/current-context";
import type { Location } from "@/types/location";
import type { PlaceSalonDetails } from "@/types/my-place";
import type { PublicStaffApplicationSalon } from "@/types/staff-salon-connection";
import { getSalonProfileMediaUploadSessionAction } from "@/app/salon-profile/actions";
import {
  applyToPlaceSalon,
  createPlaceSalon,
  getPlaceSalon,
  savePlaceSalon,
  savePlaceLogo,
  searchPlaceSalons,
} from "./actions";
import {
  Avatar,
  Field,
  FormFooter,
  LoadState,
  Notice,
  Sheet,
  button,
  inputClass,
  primaryButton,
  readForm,
} from "./place-ui";

export function placeAddress(salon?: Location) {
  return salon
    ? [
        salon.address_line1,
        salon.address_line2,
        salon.city,
        salon.state,
        salon.postal_code,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
}

function SalonFields({ salon }: { salon?: Location }) {
  return (
    <>
      <Field
        label="Salon name"
        name="name"
        value={salon?.name}
        required
        maxLength={160}
      />
      <Field label="Phone" name="phone" value={salon?.phone} type="tel" />
      <Field
        label="Street address"
        name="address_line1"
        value={salon?.address_line1}
      />
      <Field
        label="Suite / unit"
        name="address_line2"
        value={salon?.address_line2}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" name="city" value={salon?.city} />
        <Field label="State" name="state" value={salon?.state} />
        <Field label="ZIP code" name="postal_code" value={salon?.postal_code} />
        {salon ? (
          <Field
            label="Country code"
            name="country"
            value={salon.country}
            required
            maxLength={2}
          />
        ) : (
          <input type="hidden" name="country" value="US" />
        )}
      </div>
    </>
  );
}

export function CreateSalonPanel({
  accounts,
  initialAccount,
  onClose,
  onSaved,
}: {
  accounts: Workspace[];
  initialAccount?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const lock = useRef(false);
  function submit(form: FormData) {
    if (lock.current) return;
    lock.current = true;
    key.current ??= crypto.randomUUID();
    form.set("create_request_key", key.current);
    start(async () => {
      try {
        const result = await createPlaceSalon(form);
        if (result.ok) onSaved();
        else setError(result.message);
      } catch {
        setError("Unable to create this salon. Please try again.");
      } finally {
        lock.current = false;
      }
    });
  }
  return (
    <Sheet
      title="Create salon"
      subtitle="Add a salon to your business account."
      busy={busy}
      dirty={dirty}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => submit(readForm(event))}
        onChange={() => setDirty(true)}
        className="grid gap-4"
      >
        <fieldset disabled={busy} className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Business account
            <select
              className={inputClass}
              name="workspace_id"
              defaultValue={initialAccount ?? accounts[0]?.id}
              required
            >
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <SalonFields />
        </fieldset>
        {error ? <Notice error>{error}</Notice> : null}
        <FormFooter busy={busy} label="Create salon" />
      </form>
    </Sheet>
  );
}

export function SalonDetailsPanel({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [details, setDetails] = useState<PlaceSalonDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, start] = useTransition();
  const [logoBusy, setLogoBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPlaceSalon(workspace.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setDetails(result.data);
        else setLoadError(result.message);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Unable to load this salon.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);
  async function load() {
    setLoadError(null);
    try {
      const result = await getPlaceSalon(workspace.id);
      if (result.ok) setDetails(result.data);
      else setLoadError(result.message);
    } catch {
      setLoadError("Unable to load this salon.");
    }
  }
  function submit(form: FormData) {
    start(async () => {
      setError(null);
      setSuccess(null);
      try {
        const result = await savePlaceSalon(workspace.id, form);
        if (!result.ok) setError(result.message);
        else {
          setDirty(false);
          setEditing(false);
          setSuccess("Salon details saved.");
          onSaved("Salon details saved.");
          await load();
        }
      } catch {
        setError("Unable to save salon details. Please try again.");
      }
    });
  }
  return (
    <Sheet
      title={details?.salon.name ?? workspace.label}
      subtitle={`${workspace.roleLabel} · ${workspace.accountName ?? "Salon"}`}
      busy={busy || logoBusy}
      dirty={dirty}
      onClose={onClose}
    >
      <div className="grid gap-5">
        {!details ? (
          <LoadState error={loadError ?? undefined} retry={() => void load()} />
        ) : (
          <>
            {success ? <Notice>{success}</Notice> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full bg-[#f6f3f0] px-3 py-1 text-xs font-semibold capitalize">
                {details.salon.status.replaceAll("_", " ")}
              </span>
              {details.canEdit && !editing ? (
                <button
                  className={button}
                  disabled={logoBusy}
                  onClick={() => {
                    setEditing(true);
                    setSuccess(null);
                  }}
                >
                  Edit details
                </button>
              ) : null}
            </div>
            {editing ? (
              <form
                onSubmit={(event) => submit(readForm(event))}
                onChange={() => setDirty(true)}
                className="grid gap-4"
              >
                <fieldset disabled={busy} className="grid gap-4">
                  <SalonFields salon={details.salon} />
                </fieldset>
                {error ? <Notice error>{error}</Notice> : null}
                <FormFooter busy={busy} />
                <button
                  className={button}
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm("Discard your unsaved changes?")
                    ) {
                      setEditing(false);
                      setDirty(false);
                      setError(null);
                    }
                  }}
                >
                  Cancel editing
                </button>
              </form>
            ) : (
              <dl className="grid gap-4 text-sm">
                {[
                  ["Salon", details.salon.name],
                  ["Business account", workspace.accountName],
                  ["Phone", details.salon.phone],
                  ["Address", placeAddress(details.salon)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                    <dd className="mt-1 break-words font-medium">
                      {value || "Not provided"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {!editing && details.canEditLogo ? (
              <LogoEditor
                workspace={workspace}
                onSaved={onSaved}
                onBusy={setLogoBusy}
              />
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

function LogoEditor({
  workspace,
  onSaved,
  onBusy,
}: {
  workspace: Workspace;
  onSaved: (message: string) => void;
  onBusy: (value: boolean) => void;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  function upload(file?: File) {
    if (!file) return;
    onBusy(true);
    start(async () => {
      setError(null);
      try {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 8 * 1024 * 1024
        )
          throw new Error("Choose a JPG, PNG, or WebP image up to 8 MB.");
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Your browser could not process this image.");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("Unable to process image.")),
            "image/webp",
            0.9,
          ),
        );
        const session = await getSalonProfileMediaUploadSessionAction(
          "identity",
          "logo",
          workspace.id,
        );
        const response = await fetch(
          `${session.supabaseUrl}/storage/v1/object/${session.bucket}/${session.path}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              apikey: session.anonKey,
              "Content-Type": "image/webp",
              "x-upsert": "false",
            },
            body: blob,
          },
        );
        if (!response.ok)
          throw new Error("Logo upload failed. Please try again.");
        const result = await savePlaceLogo(workspace.id, session.path);
        if (!result.ok) throw new Error(result.message);
        onSaved("Salon logo updated.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to update logo.");
      } finally {
        onBusy(false);
        if (input.current) input.current.value = "";
      }
    });
  }
  return (
    <div className="grid gap-3 border-t border-[#eee5df] pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar workspace={workspace} />
        <button
          className={button}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Saving…" : "Change logo"}
        </button>
        {workspace.avatarUrl ? (
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              onBusy(true);
              start(async () => {
                try {
                  const result = await savePlaceLogo(workspace.id, null);
                  if (result.ok) onSaved("Salon logo removed.");
                  else setError(result.message);
                } catch {
                  setError("Unable to remove logo.");
                } finally {
                  onBusy(false);
                }
              });
            }}
          >
            Remove logo
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        aria-label="Upload salon logo"
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <p className="text-xs text-zinc-500">
        JPG, PNG, or WebP, up to 8 MB. Logo changes save immediately.
      </p>
      {error ? <Notice error>{error}</Notice> : null}
    </div>
  );
}

export function ApplyPanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicStaffApplicationSalon[] | null>(
    null,
  );
  const [selected, setSelected] = useState<PublicStaffApplicationSalon | null>(
    null,
  );
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  return (
    <Sheet
      title="Apply to salon"
      subtitle="Find a salon and send your application here."
      busy={busy}
      dirty={dirty}
      onClose={onClose}
    >
      <div className="grid gap-4">
        {!selected ? (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                start(async () => {
                  setError(null);
                  try {
                    const result = await searchPlaceSalons(query);
                    if (result.ok) setResults(result.data);
                    else setError(result.message);
                  } catch {
                    setError("Search is unavailable. Please try again.");
                  }
                });
              }}
            >
              <input
                aria-label="Salon name or address"
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Salon name or address"
                minLength={2}
                maxLength={160}
                required
                disabled={busy}
              />
              <button className={primaryButton} disabled={busy} type="submit">
                {busy ? "Searching…" : "Search"}
              </button>
            </form>
            <p className="text-xs text-zinc-500">
              Results show salons that accept staff applications.
            </p>
            {results?.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No matching salons accepting applications. Try another name or
                address.
              </p>
            ) : null}
            {results?.map((s) => (
              <button
                key={s.salon_id}
                className="rounded-xl border border-[#eee5df] p-4 text-left transition hover:bg-[#fff5ef]"
                onClick={() => {
                  setSelected(s);
                  setError(null);
                }}
              >
                <span className="block text-sm font-bold">{s.salon_name}</span>
                <span className="mt-1 block text-xs text-zinc-500">
                  {[s.address_line1, s.city, s.state]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                <span className="mt-2 block text-xs font-semibold text-[#d65c2b]">
                  Apply →
                </span>
              </button>
            ))}
          </>
        ) : (
          <form
            className="grid gap-4"
            onChange={() => setDirty(true)}
            onSubmit={(event) => {
              const form = readForm(event);
              start(async () => {
                setError(null);
                try {
                  const result = await applyToPlaceSalon(form);
                  if (result.ok) onSaved();
                  else setError(result.message);
                } catch {
                  setError("Unable to send your application.");
                }
              });
            }}
          >
            <div>
              <h3 className="font-bold">{selected.salon_name}</h3>
              <p className="mt-1 text-sm text-zinc-500">
                {[selected.address_line1, selected.city, selected.state]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <input type="hidden" name="salon_id" value={selected.salon_id} />
            <fieldset className="grid gap-4" disabled={busy}>
              <Field label="Position / job title" name="requested_job_title" />
              <label className="grid gap-1.5 text-sm font-medium">
                Message
                <textarea
                  className={inputClass}
                  rows={4}
                  name="message"
                  maxLength={2000}
                  placeholder="Introduce yourself to the salon…"
                />
              </label>
            </fieldset>
            <FormFooter busy={busy} label="Send application" />
            <button
              className={button}
              disabled={busy}
              type="button"
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("Discard your application draft?")
                ) {
                  setSelected(null);
                  setDirty(false);
                }
              }}
            >
              Choose another salon
            </button>
          </form>
        )}
        {error ? <Notice error>{error}</Notice> : null}
      </div>
    </Sheet>
  );
}

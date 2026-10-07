"use client";

import { useEffect, useRef, useState } from "react";
import {
  createSettingsSalon,
  loadSettingsSalonList,
  saveSettingsSalon,
  selectSettingsSalon,
} from "./salon-list-actions";
import type { BusinessClaimMatch } from "@/lib/business-claims";

type Dashboard = Awaited<ReturnType<typeof loadSettingsSalonList>>;
type Salon = Dashboard["salons"][number];
const button =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50";
const primary = `${button} !border-zinc-950 !bg-zinc-950 !text-white`;
const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm";
const fields = [
  ["name", "Salon name", "organization"],
  ["phone", "Phone", "tel"],
  ["address_line1", "Address", "address-line1"],
  ["address_line2", "Unit / suite", "address-line2"],
  ["city", "City", "address-level2"],
  ["state", "State", "address-level1"],
  ["postal_code", "ZIP code", "postal-code"],
] as const;
function SalonFields({ salon, busy }: { salon?: Salon; busy: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([name, label, autoComplete]) => (
        <label
          className={`grid gap-1 text-sm ${name === "name" ? "sm:col-span-2" : ""}`}
          key={name}
        >
          {label}
          <input
            name={name}
            autoComplete={autoComplete}
            type={name === "phone" ? "tel" : "text"}
            className={field}
            defaultValue={salon?.[name] ?? ""}
            required={name === "name"}
            disabled={busy}
            maxLength={name === "name" ? 200 : 250}
          />
        </label>
      ))}
    </div>
  );
}

export function SalonListPanel({ initialCreate = false, createOnly = false, onChanged }: { initialCreate?: boolean; createOnly?: boolean; onChanged?: () => void | Promise<void> }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<string | null>(initialCreate ? "new" : null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<BusinessClaimMatch[]>([]);
  const [accountId, setAccountId] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    loadSettingsSalonList(accountId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load salons.");
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  async function run(
    operation: () => Promise<
      | { ok: true }
      | { ok: false; error: string; matches?: BusinessClaimMatch[] }
    >,
    message: string,
    closeEditor = false,
  ) {
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.error);
        setMatches(result.matches ?? []);
        return;
      }
      setNotice(message);
      if (closeEditor) {
        setEditor(null);
        setMatches([]);
      }
      try {
        setData(await loadSettingsSalonList(data.accountId));
        await onChanged?.();
      } catch {
        setError(
          "Your change was saved, but the salon list could not refresh. Reload the list to see the latest information.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update salon.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    void loadSettingsSalonList(accountId ?? data?.accountId)
      .then(setData)
      .catch(() => setError("Could not load salons."))
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }

  return (
    <div className="grid gap-4" aria-busy={busy}>
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-800"
        >
          <p>{error}</p>
          {!data || notice ? (
            <button
              className={`${button} mt-2`}
              disabled={busy}
              onClick={reload}
            >
              Reload list
            </button>
          ) : null}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {!data ? (
        !error && (
          <p role="status" className="text-sm text-zinc-500">
            Loading salons…
          </p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            {data.accounts.length > 1 && (
              <label className="grid gap-1 text-sm">
                Business account
                <select
                  className={field}
                  disabled={busy}
                  value={data.accountId}
                  onChange={(event) => {
                    setAccountId(event.target.value);
                    setData(null);
                    setEditor(createOnly ? "new" : null);
                    setMatches([]);
                    setQuery("");
                    setError("");
                    setNotice("");
                  }}
                >
                  {data.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {data.canCreate && (
              <button
                className={`${primary} ml-auto`}
                disabled={busy}
                aria-expanded={editor === "new"}
                onClick={() => {
                  setEditor(editor === "new" ? null : "new");
                  setMatches([]);
                  setError("");
                }}
              >
                + Add salon
              </button>
            )}
          </div>
          {editor === "new" && data.canCreate && (
            <form
              key={`new-${data.accountId}`}
              className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4"
              onChange={(event) => {
                if (
                  event.target instanceof HTMLInputElement && event.target.name !==
                  "duplicate_acknowledged"
                )
                  setMatches([]);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(
                  () =>
                    createSettingsSalon(
                      data.accountId,
                      data.createRequestKey,
                      form,
                    ),
                  "Salon created.",
                  true,
                );
              }}
            >
              <h3 className="font-semibold">Add salon</h3>
              <SalonFields busy={busy} />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="owner_is_staff"
                  value="yes"
                  disabled={busy}
                  className="mt-1"
                />
                I also work as staff at this salon
              </label>
              {matches.length > 0 && (
                <div className="grid gap-3 rounded-md bg-amber-50 p-3">
                  <p className="text-sm font-semibold">
                    These salons may match:
                  </p>
                  {matches.map((match) => (
                    <div key={match.salon_id} className="text-sm">
                      <p className="font-medium">{match.name}</p>
                      <p className="text-zinc-600">
                        {match.address}
                        {match.phone ? ` · ${match.phone}` : ""}
                      </p>
                    </div>
                  ))}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      className="mt-1"
                      name="duplicate_acknowledged"
                      type="checkbox"
                      value="yes"
                      disabled={busy}
                      required
                    />
                    My salon is different from these existing salons.
                  </label>
                </div>
              )}
              <div className="flex gap-2">
                <button className={primary} disabled={busy}>
                  {busy ? "Creating…" : "Create salon"}
                </button>
                <button
                  className={button}
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setEditor(createOnly ? "new" : null);
                    setMatches([]);
                    setError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {!createOnly && data.salons.length > 5 && (
            <label className="grid gap-1 text-sm">
              Find salon
              <input
                className={field}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or address"
              />
            </label>
          )}
          {!createOnly && data.salons.length === 0 && (
            <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
              No salons in this business account yet.
            </p>
          )}
          {(createOnly ? [] : data.salons)
            .filter((salon) =>
              [salon.name, salon.address_line1, salon.city, salon.state]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map((salon) => (
              <article
                className="rounded-lg border border-zinc-200 bg-white p-4"
                key={salon.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{salon.name}</h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      {[
                        salon.address_line1,
                        salon.address_line2,
                        salon.city,
                        salon.state,
                        salon.postal_code,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    <div className="mt-2 flex gap-2 text-xs">
                      <span className="rounded-md bg-zinc-100 px-2 py-1 capitalize">
                        {salon.status.replaceAll("_", " ")}
                      </span>
                      {salon.isCurrent && (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                          Current salon
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {salon.canEdit && (
                      <button
                        className={button}
                        disabled={busy}
                        aria-expanded={editor === salon.id}
                        onClick={() => {
                          setEditor(editor === salon.id ? null : salon.id);
                          setError("");
                        }}
                      >
                        {editor === salon.id ? "Close editor" : "Edit"}
                      </button>
                    )}
                    {!salon.isCurrent && salon.canSelect && (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => selectSettingsSalon(data.accountId, salon.id),
                            `${salon.name} is now the current salon.`,
                          )
                        }
                      >
                        Select
                      </button>
                    )}
                  </div>
                </div>
                {editor === salon.id && (
                  <form
                    className="mt-4 grid gap-4 border-t border-zinc-100 pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void run(
                        () => saveSettingsSalon(data.accountId, salon.id, form),
                        "Salon information saved.",
                        true,
                      );
                    }}
                  >
                    <SalonFields salon={salon} busy={busy} />
                    <div className="flex gap-2">
                      <button className={primary} disabled={busy}>
                        {busy ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        className={button}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditor(null);
                          setError("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          {query &&
            !data.salons.some((salon) =>
              [salon.name, salon.address_line1, salon.city, salon.state]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            ) && <p className="text-sm text-zinc-500">No matching salons.</p>}
        </>
      )}
    </div>
  );
}

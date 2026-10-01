"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { saveTodayQuickAccessesAction } from "@/app/staff/today/actions";
import type {
  TodayQuickAccess,
  TodayQuickAccessConfiguration,
} from "@/lib/today-quick-accesses";

function ShortcutIcon({ name }: { name: TodayQuickAccess["icon"] }) {
  const paths: Partial<Record<TodayQuickAccess["icon"], React.ReactNode>> = {
    bell: (
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" />,
    briefcase: (
      <>
        <path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1" />
        <rect height="14" rx="2" width="18" x="3" y="6" />
        <path d="M3 12h18" />
      </>
    ),
    calendar: (
      <>
        <path d="M8 2v4M16 2v4M3 10h18" />
        <rect height="18" rx="2" width="18" x="3" y="4" />
      </>
    ),
    cash: (
      <>
        <rect height="12" rx="2" width="18" x="3" y="6" />
        <path d="M8 12h.01M16 12h.01M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    compass: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </>
    ),
    grid: (
      <>
        <rect height="7" rx="1.5" width="7" x="3" y="3" />
        <rect height="7" rx="1.5" width="7" x="14" y="3" />
        <rect height="7" rx="1.5" width="7" x="3" y="14" />
        <rect height="7" rx="1.5" width="7" x="14" y="14" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
      </>
    ),
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    receipt: (
      <>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
        <path d="M9 9h6M9 13h6" />
      </>
    ),
    scissors: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.1 15.9M8.1 8.1 20 20" />
      </>
    ),
    search: <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />,
    star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1L12 2Z" />,
    store: (
      <>
        <path d="m4 10 1-6h14l1 6" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    x: <path d="M18 6 6 18M6 6l12 12" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name] ?? paths.grid}
    </svg>
  );
}

function UtilityIcon({
  name,
}: {
  name: "chevron-down" | "down" | "edit" | "plus" | "quick" | "remove" | "up";
}) {
  const path =
    name === "quick"
      ? "M4 13h6v7H4v-7Zm10-9h6v16h-6V4ZM4 4h6v5H4V4Z"
      : name === "edit"
        ? "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
        : name === "plus"
          ? "M12 5v14M5 12h14"
          : name === "remove"
            ? "M18 6 6 18M6 6l12 12"
            : name === "up"
              ? "m6 15 6-6 6 6"
              : name === "down"
                ? "m6 9 6 6 6-6"
                : "m6 9 6 6 6-6";

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  );
}

function allShortcutOptions(configuration: TodayQuickAccessConfiguration) {
  const byId = new Map<TodayQuickAccess["id"], TodayQuickAccess>();

  for (const shortcut of [
    ...configuration.selected,
    ...configuration.available,
  ]) {
    byId.set(shortcut.id, shortcut);
  }

  return Array.from(byId.values());
}

export function QuickAccessPanel({
  configuration,
}: {
  configuration: TodayQuickAccessConfiguration;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(configuration.selected);
  const [error, setError] = useState<string | null>(null);
  const allShortcuts = useMemo(
    () => allShortcutOptions(configuration),
    [configuration],
  );
  const selectedIds = useMemo(
    () => new Set(draft.map((shortcut) => shortcut.id)),
    [draft],
  );
  const available = allShortcuts.filter(
    (shortcut) => !selectedIds.has(shortcut.id),
  );
  const canAdd =
    configuration.canCustomize &&
    draft.length < configuration.maxSelected &&
    available.length > 0;

  function moveShortcut(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const item = next[index];
      next[index] = next[nextIndex];
      next[nextIndex] = item;

      return next;
    });
  }

  function removeShortcut(shortcutId: TodayQuickAccess["id"]) {
    setDraft((current) =>
      current.filter((shortcut) => shortcut.id !== shortcutId),
    );
  }

  function addShortcut(shortcut: TodayQuickAccess) {
    setDraft((current) => {
      if (
        current.length >= configuration.maxSelected ||
        current.some((item) => item.id === shortcut.id)
      ) {
        return current;
      }

      return [...current, shortcut];
    });
  }

  function cancelEditing() {
    setDraft(configuration.selected);
    setEditing(false);
    setError(null);
  }

  function saveEditing() {
    const formData = new FormData();

    for (const shortcut of draft) {
      formData.append("shortcutIds", shortcut.id);
    }

    setError(null);
    startTransition(() => {
      void (async () => {
        try {
          await saveTodayQuickAccessesAction(formData);
          setEditing(false);
          router.refresh();
        } catch (saveError) {
          setError(
            saveError instanceof Error
              ? saveError.message
              : "Quick accesses could not be saved.",
          );
        }
      })();
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-[0_10px_30px_rgba(24,24,27,0.04)]">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
            <UtilityIcon name="quick" />
          </span>
          <h2 className="truncate text-base font-semibold text-zinc-950">
            Quick Accesses
          </h2>
        </div>
        {configuration.canCustomize && !editing ? (
          <button
            aria-label="Edit quick accesses"
            className="grid min-h-11 min-w-11 place-items-center rounded-md border border-zinc-200 text-zinc-600 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            title="Edit quick accesses"
            type="button"
            onClick={() => {
              setDraft(configuration.selected);
              setError(null);
              setEditing(true);
            }}
          >
            <UtilityIcon name="edit" />
          </button>
        ) : null}
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="space-y-3">
          {configuration.loadError ? (
            <p className="text-xs font-medium text-amber-700">
              {configuration.loadError}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}

          {!editing ? (
            configuration.selected.length > 0 ? (
              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-2">
                {configuration.selected.map((shortcut) => (
                  <Link
                    aria-label={`Open ${shortcut.label}`}
                    className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 text-sm font-semibold text-zinc-800 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    href={shortcut.href}
                    key={shortcut.id}
                    title={shortcut.description}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-amber-700 shadow-sm">
                      <ShortcutIcon name={shortcut.icon} />
                    </span>
                    <span className="min-w-0 truncate">{shortcut.label}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                No quick accesses selected.
              </p>
            )
          ) : (
            <div className="space-y-4">
              {draft.length > 0 ? (
                <ul className="space-y-2">
                  {draft.map((shortcut, index) => (
                    <li
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-2 shadow-sm"
                      key={shortcut.id}
                    >
                      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-700">
                          <ShortcutIcon name={shortcut.icon} />
                        </span>
                        <span className="min-w-0 truncate text-sm font-semibold text-zinc-950">
                          {shortcut.label}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          aria-label={`Move ${shortcut.label} earlier`}
                          className="grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:text-zinc-300"
                          disabled={index === 0 || isPending}
                          title={`Move ${shortcut.label} earlier`}
                          type="button"
                          onClick={() => moveShortcut(index, -1)}
                        >
                          <UtilityIcon name="up" />
                        </button>
                        <button
                          aria-label={`Move ${shortcut.label} later`}
                          className="grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:text-zinc-300"
                          disabled={index === draft.length - 1 || isPending}
                          title={`Move ${shortcut.label} later`}
                          type="button"
                          onClick={() => moveShortcut(index, 1)}
                        >
                          <UtilityIcon name="down" />
                        </button>
                        <button
                          aria-label={`Remove ${shortcut.label}`}
                          className="grid min-h-11 min-w-11 place-items-center rounded-md text-zinc-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:text-zinc-300"
                          disabled={isPending}
                          title={`Remove ${shortcut.label}`}
                          type="button"
                          onClick={() => removeShortcut(shortcut.id)}
                        >
                          <UtilityIcon name="remove" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                  No quick accesses selected.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {canAdd ? (
                  <details className="relative">
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                      <UtilityIcon name="plus" />
                      <span>Add shortcut</span>
                      <UtilityIcon name="chevron-down" />
                    </summary>
                    <div className="absolute left-0 z-20 mt-2 max-h-72 w-[min(20rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl">
                      <div className="grid gap-1">
                        {available.map((shortcut) => (
                          <button
                            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-zinc-800 transition hover:bg-amber-50 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                            key={shortcut.id}
                            title={shortcut.description}
                            type="button"
                            onClick={() => addShortcut(shortcut)}
                          >
                            <ShortcutIcon name={shortcut.icon} />
                            <span className="min-w-0 truncate">
                              {shortcut.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>
                ) : (
                  <span className="text-sm text-zinc-500">
                    {draft.length >= configuration.maxSelected
                      ? "Shortcut limit reached."
                      : "No more shortcuts available."}
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    className="min-h-11 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isPending}
                    type="button"
                    onClick={cancelEditing}
                  >
                    Cancel
                  </button>
                  <button
                    className="min-h-11 rounded-md bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-amber-300"
                    disabled={isPending}
                    type="button"
                    onClick={saveEditing}
                  >
                    {isPending ? "Saving" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

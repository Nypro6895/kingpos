"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Sheet, inputClass, primaryButton } from "@/app/my-place/place-ui";

type Entry = {
  id: string;
  group: "applications" | "invitations" | "history";
  name: string;
  contact: string;
  status: string;
  date: string;
  kind: string;
  detail: ReactNode;
};
const BusyContext = createContext<((value: boolean) => void) | null>(null);

export function RequestForm({
  action,
  children,
  className,
}: {
  action: (form: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form className={className} action={action}>
      <RequestFormContents>{children}</RequestFormContents>
    </form>
  );
}

function RequestFormContents({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  const setDrawerBusy = useContext(BusyContext);
  useEffect(() => {
    setDrawerBusy?.(pending);
    return () => setDrawerBusy?.(false);
  }, [pending, setDrawerBusy]);
  return (
    <>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {pending ? (
        <p role="status" className="text-sm text-zinc-500">
          Saving...
        </p>
      ) : null}
    </>
  );
}

export function RequestsWorkspace({
  feedback,
  entries,
  invite,
  initialInvite,
  initialRequest,
}: {
  feedback?: ReactNode;
  entries: Entry[];
  invite: ReactNode;
  initialInvite: boolean;
  initialRequest?: string;
}) {
  const [tab, setTab] = useState<Entry["group"]>(
    initialRequest ? "invitations" : "applications",
  );
  const [selected, setSelected] = useState<string | null>(
    initialRequest ?? (initialInvite ? "invite" : null),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = entries.find((item) => item.id === selected);
  const visible = entries.filter((item) => item.group === tab);
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Requests</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Staff applications and invitations.
          </p>
        </div>
        <button
          className="min-h-11 shrink-0 text-sm font-semibold text-teal-700 hover:underline"
          onClick={() => {
            setDirty(false);
            setSelected("invite");
          }}
        >
          + Invite staff
        </button>
      </div>
      <nav
        aria-label="Request views"
        className="flex gap-4 border-b border-zinc-200 sm:gap-6"
      >
        {(["applications", "invitations", "history"] as const).map((group) => (
          <button
            key={group}
            aria-pressed={tab === group}
            onClick={() => setTab(group)}
            className={`min-h-11 border-b-2 text-xs sm:text-sm ${tab === group ? "border-teal-700 font-semibold text-teal-700" : "border-transparent text-zinc-500"}`}
          >
            {group === "applications"
              ? "Applications"
              : group === "invitations"
                ? "Invitations"
                : "History"}{" "}
            <span className="ml-1 text-xs">
              {entries.filter((item) => item.group === group).length}
            </span>
          </button>
        ))}
      </nav>
      {visible.length ? (
        <ul className="divide-y divide-zinc-100">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-4 text-left hover:bg-zinc-50 focus-visible:outline-teal-700"
                onClick={() => {
                  setDirty(false);
                  setSelected(item.id);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {item.name}
                  </span>
                  <span className="mt-1 block truncate text-xs text-zinc-500">
                    {item.kind} · {item.date}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block text-xs font-medium capitalize ${item.status === "accepted" ? "text-teal-700" : item.status === "pending" ? "text-amber-700" : "text-zinc-500"}`}
                  >
                    {item.status}
                  </span>
                  <span className="mt-1 block text-xs text-teal-700">
                    View →
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-5 text-sm text-zinc-500">
          {tab === "applications"
            ? "No applications awaiting review."
            : tab === "invitations"
              ? "No outgoing invitations."
              : "No connection history yet."}
        </p>
      )}
      {selected === "invite" || entry ? (
        <Sheet
          title={entry?.name ?? "Invite staff"}
          subtitle={
            entry
              ? `${entry.kind} · ${entry.status}`
              : "Find an account and send an invitation."
          }
          busy={busy}
          dirty={dirty}
          onClose={() => setSelected(null)}
        >
          <BusyContext.Provider value={setBusy}>
            {feedback ? <div className="mb-4">{feedback}</div> : null}
            <div
              className="min-w-0 break-words"
              onChange={() => setDirty(true)}
            >
              <fieldset disabled={busy} className="min-w-0">
                {entry?.detail ?? invite}
              </fieldset>
            </div>
          </BusyContext.Provider>
        </Sheet>
      ) : null}
    </section>
  );
}

export function RequestAccountSearch({
  email,
  phone,
}: {
  email: string;
  phone: string;
}) {
  const [mode, setMode] = useState<"email" | "phone">(
    phone && !email ? "phone" : "email",
  );
  const [busy, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const params = new URLSearchParams({
          [`invite_${mode}`]: String(form.get(`invite_${mode}`)).trim(),
        });
        start(() => router.push(`/staff?${params}`, { scroll: false }));
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <legend className="mb-2 text-sm text-zinc-500">
          Search by exact email or phone
        </legend>
        <div className="flex gap-5">
          {(["email", "phone"] as const).map((value) => (
            <label
              key={value}
              className="flex min-h-10 cursor-pointer items-center gap-2 text-sm capitalize"
            >
              <input
                type="radio"
                name="search_mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="accent-teal-700"
              />
              {value}
            </label>
          ))}
        </div>
        <label className="grid gap-2 text-sm capitalize">
          {mode}
          <input
            key={mode}
            className={inputClass}
            type={mode === "email" ? "email" : "tel"}
            name={`invite_${mode}`}
            defaultValue={mode === "email" ? email : phone}
            required
          />
        </label>
        <button className={primaryButton} type="submit">
          {busy ? "Searching…" : "Search account"}
        </button>
      </fieldset>
    </form>
  );
}

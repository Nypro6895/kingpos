"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadSettingsConnections,
  searchSettingsConnectionSalons,
  updateSettingsConnection,
} from "./connections-actions";
import type {
  PublicStaffApplicationSalon,
  StaffConnectionDashboardRequest,
} from "@/types/staff-salon-connection";

type Dashboard = Awaited<ReturnType<typeof loadSettingsConnections>>;
type Update = Parameters<typeof updateSettingsConnection>[0];
const button =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-50";
const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm";
const card = "rounded-lg border border-zinc-200 bg-white p-4";
function address(
  salon: PublicStaffApplicationSalon | StaffConnectionDashboardRequest,
) {
  return [salon.address_line1, salon.city, salon.state, salon.postal_code]
    .filter(Boolean)
    .join(", ");
}
function date(value: string | null) {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleDateString("en-US")
    : "—";
}

export function ConnectionsPanel({onChanged,onManageSalon}: {onChanged?:()=>Promise<void>;onManageSalon?:(salonId:string,mode:string)=>void} = {}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState<PublicStaffApplicationSalon[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadSettingsConnections()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load connections.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(input: Update) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await updateSettingsConnection(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        {
          "owner-accept": "Ownership invitation accepted.",
          "owner-ignore": "Ownership invitation declined.",
          accept: "Invitation accepted.",
          decline: "Invitation declined.",
          cancel: "Application cancelled.",
          apply: "Application submitted.",
        }[input.action],
      );
      if (input.action === "apply") setSelected(null);
      try {
        setData(await loadSettingsConnections());
        await onChanged?.();
      } catch {
        setError(
          "Your change was saved, but the list could not refresh. Reload connections to see the latest status.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update connection.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function requestCard(request: StaffConnectionDashboardRequest) {
    const expired = Boolean(
      request.expires_at &&
      Date.parse(request.expires_at) <= (data?.loadedAt ?? 0),
    );
    const pending =
      request.status === "pending" &&
      (request.direction !== "salon_invite" || !expired);
    return (
      <article className={card} key={request.id}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold">{request.salon_name}</h4>
            <p className="mt-1 text-sm text-zinc-500">{address(request)}</p>
          </div>
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs capitalize">
            {expired && request.status === "pending"
              ? "Expired"
              : request.status}
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-600">
          {request.direction === "salon_invite"
            ? `Invited as ${request.staff_job_title ?? "Staff"} · Expires ${date(request.expires_at)}`
            : `${request.requested_job_title ?? "Staff"} · Submitted ${date(request.created_at)}`}
        </p>
        {request.message && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">
            {request.message}
          </p>
        )}
        {pending && (
          <div className="mt-3 flex gap-2">
            {request.direction === "salon_invite" ? (
              <>
                <button
                  className={`${button} !border-zinc-950 !bg-zinc-950 !text-white`}
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "accept", requestId: request.id })
                  }
                >
                  Accept
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "decline", requestId: request.id })
                  }
                >
                  Decline
                </button>
              </>
            ) : (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run({ action: "cancel", requestId: request.id })
                }
              >
                Cancel application
              </button>
            )}
          </div>
        )}
      </article>
    );
  }

  const pending =
    data?.requests.filter(
      (r) =>
        r.status === "pending" &&
        !(
          r.direction === "salon_invite" &&
          r.expires_at &&
          Date.parse(r.expires_at) <= data.loadedAt
        ),
    ) ?? [];
  const invitations = pending.filter((r) => r.direction === "salon_invite");
  const applications = pending.filter(
    (r) => r.direction === "staff_application",
  );
  const history = data?.requests.filter((r) => !pending.includes(r)) ?? [];
  return (
    <div className="grid gap-5" aria-busy={busy}>
      {error && (
        <p
          className="rounded-md bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800"
          role="status"
        >
          {notice}
        </p>
      )}
      {!data ? (
        error ? (
          <button
            className={button}
            onClick={() => {
              setError("");
              void loadSettingsConnections()
                .then(setData)
                .catch(() => setError("Could not load connections."));
            }}
          >
            Retry
          </button>
        ) : (
          <p role="status" className="text-sm text-zinc-500">
            Loading connections…
          </p>
        )
      ) : (
        <>
          {data.ownersError?<p role="alert" className="text-sm text-red-700">{data.ownersError}</p>:null}
          {data.ownerInvites.map(invite=><article className={card} key={invite.id}><p className="font-semibold">{invite.salonName} · {invite.mode==="add_co_owner"?"Co-owner invitation":"Ownership transfer"}</p>{invite.message?<p className="mt-2 text-sm">{invite.message}</p>:null}<p className="mt-1 text-xs text-zinc-500">Expires {date(invite.expiresAt)}</p><div className="mt-3 flex gap-2"><button className={button} disabled={busy} onClick={()=>void run({action:"owner-accept",requestId:invite.id})}>Accept ownership</button><button className={button} disabled={busy} onClick={()=>void run({action:"owner-ignore",requestId:invite.id})}>Decline</button></div></article>)}
          {data.requestsError && (
            <div
              role="alert"
              className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p>
                Could not load invitations and applications:{" "}
                {data.requestsError}
              </p>
              <button
                className={`${button} mt-2`}
                disabled={busy}
                onClick={() => {
                  void loadSettingsConnections()
                    .then(setData)
                    .catch(() => setError("Could not reload connections."));
                }}
              >
                Retry
              </button>
            </div>
          )}
          {invitations.length > 0 && (
            <section className="grid gap-3">
              <h3 className="font-semibold">Pending invitations</h3>
              {invitations.map(requestCard)}
            </section>
          )}
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Connected salons</h3>
              <button
                className={button}
                disabled={busy}
                aria-expanded={adding}
                onClick={() => setAdding(!adding)}
              >
                {adding ? "Close search" : "+ Add connection"}
              </button>
            </div>
            {data.salons.length ? (
              data.salons.map((salon) => (
                <details className={card} key={salon.id}>
                  <summary className="cursor-pointer font-semibold">
                    {salon.name}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {salon.role}
                    </span>
                  </summary>
                  <dl className="mt-3 grid gap-2 text-sm text-zinc-600">
                    <div>
                      <dt className="inline font-medium">Role: </dt>
                      <dd className="inline">{salon.role}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Status: </dt>
                      <dd className="inline">Connected</dd>
                    </div>
                    {salon.description && (
                      <div>
                        <dt className="sr-only">Details</dt>
                        <dd>{salon.description}</dd>
                      </div>
                    )}
                  </dl>
                  {onManageSalon?<button className={`${button} mt-3`} onClick={()=>onManageSalon(salon.salonId,salon.mode??"staff")}>Edit {salon.mode==="manage"?"salon settings":"my staff settings"}</button>:null}
                </details>
              ))
            ) : (
              <p className={`${card} text-sm text-zinc-500`}>
                You have no connected salons yet.
              </p>
            )}
          </section>
          {adding && (
            <section className="grid gap-3">
              <h3 className="font-semibold">Find a salon</h3>
              <form
                className={`${card} grid gap-3`}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (lock.current) return;
                  const form = new FormData(event.currentTarget);
                  lock.current = true;
                  setBusy(true);
                  setError("");
                  setSelected(null);
                  try {
                    setResults(
                      await searchSettingsConnectionSalons({
                        query: String(form.get("query") ?? ""),
                        city: String(form.get("city") ?? ""),
                        state: String(form.get("state") ?? ""),
                      }),
                    );
                    setSearched(true);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Search failed.");
                  } finally {
                    lock.current = false;
                    setBusy(false);
                  }
                }}
              >
                <label className="grid gap-1 text-sm">
                  Salon name
                  <input
                    className={field}
                    name="query"
                    type="search"
                    disabled={busy}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-sm">
                    City
                    <input className={field} name="city" disabled={busy} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    State
                    <input className={field} name="state" disabled={busy} />
                  </label>
                </div>
                <button
                  className={`${button} justify-self-start`}
                  disabled={busy}
                >
                  Search
                </button>
              </form>
              {searched && !results.length && (
                <p className="text-sm text-zinc-500">
                  No salons found. Try a salon name or location.
                </p>
              )}
              {results.map((salon) => {
                const connected = data.salons.some(
                  (s) => s.salonId === salon.salon_id,
                );
                const waiting = pending.some(
                  (r) => r.salon_id === salon.salon_id,
                );
                return (
                  <article className={card} key={salon.salon_id}>
                    <h4 className="font-semibold">{salon.salon_name}</h4>
                    <p className="mt-1 text-sm text-zinc-500">
                      {address(salon)}
                    </p>
                    {connected || waiting ? (
                      <p className="mt-3 text-sm text-zinc-500">
                        {connected ? "Already connected" : "Request pending"}
                      </p>
                    ) : selected === salon.salon_id ? (
                      <form
                        className="mt-3 grid gap-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void run({
                            action: "apply",
                            salonId: salon.salon_id,
                            title: String(form.get("title") ?? ""),
                            message: String(form.get("message") ?? ""),
                          });
                        }}
                      >
                        <label className="grid gap-1 text-sm">
                          Requested position (optional)
                          <input
                            className={field}
                            name="title"
                            disabled={busy}
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          Message (optional)
                          <textarea
                            className={field}
                            name="message"
                            rows={3}
                            disabled={busy}
                          />
                        </label>
                        <div className="flex gap-2">
                          <button className={button} disabled={busy}>
                            Send application
                          </button>
                          <button
                            className={button}
                            disabled={busy}
                            type="button"
                            onClick={() => setSelected(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        className={`${button} mt-3`}
                        disabled={busy}
                        onClick={() => setSelected(salon.salon_id)}
                      >
                        Apply
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          )}
          {applications.length > 0 && (
            <section className="grid gap-3">
              <h3 className="font-semibold">Pending applications</h3>
              {applications.map(requestCard)}
            </section>
          )}
          {history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-zinc-600">
                Connection history
              </summary>
              <div className="mt-3 grid gap-3">{history.map(requestCard)}</div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

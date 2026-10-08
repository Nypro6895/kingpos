"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  BusinessWorkspace,
  BusinessRow,
  BusinessRecord,
  BusinessReview,
} from "@/types/admin-business-workspace";
import type { PlatformAdminPermission } from "@/types/platform-admin";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import type { DashboardDetail } from "@/types/admin-dashboard";
import { DashboardDetailPanel } from "../dashboard/dashboard-detail";
import { DashboardActionForm } from "../dashboard/dashboard-action-form";
import {
  dashboardAccountAction,
  saveDashboardFollowupAction,
} from "../dashboard/account-actions";
import {
  updateAdminLocationProfileAction,
  createAdminNoteAction,
} from "../actions";
import {
  takeBusinessReviewAction,
  bulkBusinessFollowupAction,
  businessStatusAction,
} from "./workspace-actions";
import type { AdminActionResult } from "../_components/action-form";
import s from "./businesses.module.css";
const date = (v: string | null, short = false) =>
  v
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: short ? "short" : "medium",
        ...(!short ? { timeStyle: "short" as const } : {}),
        timeZone: "America/Chicago",
      }).format(new Date(v))
    : "—";
const address = (r: BusinessRow) =>
  [r.address_line1, r.address_line2, r.city, r.state, r.postal_code]
    .filter(Boolean)
    .join(", ");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
const verification = (value: string) =>
  ({
    approved: "Verified",
    waiting: "Under review",
    otp_pending: "Phone pending",
    none: "Not submitted",
    rejected: "Rejected",
    blocked: "Blocked",
    expired: "Expired",
  })[value] || value;
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    edit: "M12 5 19 12M3 21l5-1L21 7l-5-5L3 15v6Z",
    lock: "M5 10h14v11H5ZM8 10V6a4 4 0 0 1 8 0v4",
    flag: "M5 22V3h14l-3 5 3 5H5",
    history: "M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2",
    arrow: "m9 5 7 7-7 7",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    refresh: "M20 7a9 9 0 1 0 1 10M21 2v6h-6",
    close: "m5 5 14 14M19 5 5 19",
    store: "M3 9h18l-2-6H5ZM5 9v12h14V9M9 21v-7h6v7",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] || paths.store} />
    </svg>
  );
}
function Hidden({ name, value }: { name: string; value: string | null }) {
  return <input type="hidden" name={name} value={value || ""} />;
}
function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={`${s.badge} ${["active", "claimed", "approved"].includes(value) ? s.green : ["pending", "waiting", "unclaimed"].includes(value) ? s.amber : s.gray}`}
    >
      {label || value}
    </span>
  );
}
export function BusinessesWorkspace({
  data,
  permissions,
  actorId,
}: {
  data: BusinessWorkspace;
  permissions: PlatformAdminPermission[];
  actorId: string;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(
    () => params.get("business") || (data.items[0]?.id ?? null),
  );
  const [record, setRecord] = useState<BusinessRecord | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [mode, setMode] = useState("overview");
  const [review, setReview] = useState<BusinessReview | null>(null),
    [reviewData, setReviewData] = useState<DashboardDetail | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const visibleChecked = checked.filter((id) =>
    data.items.some((b) => b.id === id),
  );
  const drawerRef = useRef<HTMLElement>(null),
    lastFocus = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState("");
  const can = (p: PlatformAdminPermission) => permissions.includes(p);
  function query(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    startTransition(() =>
      router.push(`/admin/locations?${next}`, { scroll: false }),
    );
  }
  function open(id: string, nextMode = "overview") {
    lastFocus.current = document.activeElement as HTMLElement;
    setSelected(id);
    setVersion((v) => v + 1);
    setMode(nextMode);
    setReview(null);
    setError("");
    setRecord(null);
    const next = new URLSearchParams(params.toString());
    next.set("business", id);
    window.history.replaceState(null, "", `?${next}`);
  }
  function close() {
    setSelected(null);
    setReview(null);
    const next = new URLSearchParams(params.toString());
    next.delete("business");
    window.history.replaceState(null, "", `?${next}`);
    lastFocus.current?.focus();
  }
  function complete(result: AdminActionResult) {
    setNotice(result.message);
    if (result.ok) {
      setVersion((v) => v + 1);
      router.refresh();
    }
  }
  useEffect(() => {
    if (!selected) return;
    const control = new AbortController();
    fetch(`/admin/locations/workspace?id=${selected}`, {
      signal: control.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        return value as BusinessRecord;
      })
      .then((value) => {
        setRecord(value);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => control.abort();
  }, [selected, version]);
  useEffect(() => {
    if (!review) return;
    const control = new AbortController();
    fetch(
      `/admin/dashboard/detail?kind=${review.kind}&id=${review.request_id}`,
      { signal: control.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        return value as DashboardDetail;
      })
      .then(setReviewData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => control.abort();
  }, [review, version]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setReview(null);
        const next = new URLSearchParams(window.location.search);
        next.delete("business");
        window.history.replaceState(null, "", `?${next}`);
        lastFocus.current?.focus();
      }
      if (e.key === "Tab" && window.innerWidth < 1100 && drawerRef.current) {
        const controls = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
          ),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    if (window.innerWidth < 1100)
      drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);
  const row = record?.id === selected ? record.business : null;
  const tabs = [
    ["all", "All"],
    ["new", "New today"],
    ["unclaimed", "Unclaimed"],
    ["review", "Needs review"],
    ["followup", "Follow-up"],
  ] as const;
  return (
    <div className={`business-workspace ${s.workspace}`} aria-busy={pending}>
      <header className={s.heading}>
        <div>
          <h1>Businesses</h1>
          <p>
            Manage business information, ownership, verification and follow-up.
          </p>
        </div>
        <button
          onClick={() => {
            setVersion((v) => v + 1);
            router.refresh();
          }}
        >
          <Icon name="refresh" /> Refresh
        </button>
      </header>
      {notice && (
        <p className={s.notice} role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </p>
      )}
      <div className={`${s.layout} ${selected ? s.withDrawer : ""}`}>
        <div className={s.main}>
          <div className={s.overview}>
            <nav className={s.tabs} aria-label="Business views">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  aria-current={
                    (params.get("tab") || "all") === key ? "page" : undefined
                  }
                  onClick={() => query({ tab: key })}
                >
                  {label}
                  <span>{data.counts[key]}</span>
                </button>
              ))}
            </nav>
            <aside className={s.stats}>
              <h2>Overview</h2>
              {(
                [
                  ["all", "Total businesses"],
                  ["active", "Active"],
                  ["unclaimed", "Unclaimed"],
                  ["review", "Pending review"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() =>
                    query({
                      tab: key === "active" ? "all" : key,
                      status: key === "active" ? "active" : "",
                    })
                  }
                >
                  <span>{label}</span>
                  <strong>{data.counts[key]}</strong>
                </button>
              ))}
            </aside>
          </div>
          <section className={s.panel} aria-label="Business directory">
            <form
              className={s.filters}
              onSubmit={(e) => {
                e.preventDefault();
                query({
                  q: String(new FormData(e.currentTarget).get("q") || ""),
                });
              }}
            >
              <label className={s.search}>
                <Icon name="search" />
                <input
                  key={params.get("q")}
                  name="q"
                  maxLength={100}
                  defaultValue={params.get("q") || ""}
                  aria-label="Search businesses"
                  placeholder="Search business, owner, phone or address…"
                />
                <button type="submit">Search</button>
              </label>
              <div className={s.selects}>
                <select
                  aria-label="Status"
                  value={params.get("status") || ""}
                  onChange={(e) => query({ status: e.target.value })}
                >
                  <option value="">Status: All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <select
                  aria-label="Ownership"
                  value={params.get("ownership") || ""}
                  onChange={(e) => query({ ownership: e.target.value })}
                >
                  <option value="">Ownership: All</option>
                  <option value="claimed">Claimed</option>
                  <option value="unclaimed">Unclaimed</option>
                  <option value="pending">Claim pending</option>
                </select>
                <select
                  aria-label="City"
                  value={params.get("city") || ""}
                  onChange={(e) => query({ city: e.target.value })}
                >
                  <option value="">City: All</option>
                  {data.cities.map((city) => (
                    <option key={city}>{city}</option>
                  ))}
                </select>
                <select
                  aria-label="Sort businesses"
                  value={params.get("sort") || "created_desc"}
                  onChange={(e) => query({ sort: e.target.value })}
                >
                  <option value="created_desc">Newest first</option>
                  <option value="name_asc">Name A–Z</option>
                  <option value="updated_desc">Recently updated</option>
                </select>
              </div>
            </form>
            <div className={s.tableWrap}>
              <table>
                <caption>Businesses</caption>
                <thead>
                  <tr>
                    {can(P.locationsUpdateStatus) && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all businesses on this page"
                          checked={
                            data.items.length > 0 &&
                            visibleChecked.length === data.items.length
                          }
                          onChange={(e) =>
                            setChecked(
                              e.target.checked
                                ? data.items.map((b) => b.id)
                                : [],
                            )
                          }
                        />
                      </th>
                    )}
                    <th>Business</th>
                    <th>Owner</th>
                    <th>Ownership / Verification</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b) => (
                    <tr
                      key={b.id}
                      className={selected === b.id ? s.selected : ""}
                    >
                      <>
                        {can(P.locationsUpdateStatus) && (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${b.name}`}
                              checked={visibleChecked.includes(b.id)}
                              onChange={(e) =>
                                setChecked(
                                  e.target.checked
                                    ? [...visibleChecked, b.id]
                                    : visibleChecked.filter(
                                        (id) => id !== b.id,
                                      ),
                                )
                              }
                            />
                          </td>
                        )}
                      </>
                      <td>
                        <button
                          className={s.businessName}
                          onClick={() => open(b.id)}
                        >
                          <span className={s.avatar}>
                            <Icon name="store" />
                          </span>
                          <span>
                            <strong>{b.name}</strong>
                            <small>
                              {address(b) || "Address not provided"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        {b.owners.length ? (
                          b.owners.map((owner) => (
                            <div key={owner.id}>
                              <Link href={`/admin/users/${owner.id}`}>
                                {owner.name}
                              </Link>
                              <small>
                                {owner.contact ||
                                  "Contact restricted or unavailable"}
                              </small>
                            </div>
                          ))
                        ) : (
                          <small>
                            {can(P.usersRead)
                              ? "No linked owner"
                              : "Restricted by your role"}
                          </small>
                        )}
                      </td>
                      <td>
                        <div className={s.badges}>
                          <Badge
                            value={b.ownership}
                            label={
                              b.ownership === "pending"
                                ? "Claim pending"
                                : b.ownership
                            }
                          />
                          <Badge
                            value={b.verification}
                            label={verification(b.verification)}
                          />
                        </div>
                      </td>
                      <td>
                        <Badge value={b.status} />
                      </td>
                      <td>
                        <small>{date(b.created_at, true)}</small>
                      </td>
                      <td>
                        <div className={s.icons}>
                          {can(P.locationsUpdate) && (
                            <button
                              aria-label={`Edit ${b.name}`}
                              title="Edit information"
                              onClick={() => open(b.id, "edit")}
                            >
                              <Icon name="edit" />
                            </button>
                          )}
                          {can(P.locationsUpdateStatus) && (
                            <>
                              <button
                                aria-label={`${b.status === "active" ? "Disable" : "Restore"} ${b.name}`}
                                title={
                                  b.status === "active"
                                    ? "Disable business"
                                    : "Restore business"
                                }
                                onClick={() => open(b.id, "status")}
                              >
                                <Icon name="lock" />
                              </button>
                              <button
                                aria-label={`Follow up ${b.name}`}
                                aria-pressed={b.marked}
                                title="Follow-up"
                                onClick={() => open(b.id, "followup")}
                              >
                                <Icon name="flag" />
                              </button>
                            </>
                          )}
                          {can(P.auditRead) && (
                            <button
                              aria-label={`Activity of ${b.name}`}
                              title="Activity history"
                              onClick={() => open(b.id, "activity")}
                            >
                              <Icon name="history" />
                            </button>
                          )}
                          <button
                            aria-label={`Details of ${b.name}`}
                            onClick={() => open(b.id)}
                          >
                            <Icon name="arrow" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.items.length && (
                <p className={s.empty}>
                  No businesses match these filters.{" "}
                  <button onClick={() => router.push("/admin/locations")}>
                    Reset filters
                  </button>
                </p>
              )}
            </div>
            {visibleChecked.length > 0 && (
              <DashboardActionForm
                className={s.bulkForm}
                action={bulkBusinessFollowupAction}
                onComplete={(r) => {
                  complete(r);
                  if (r.ok) setChecked([]);
                }}
                confirmMessage={`Mark ${visibleChecked.length} businesses for follow-up?`}
              >
                {visibleChecked.map((id) => (
                  <Hidden key={id} name="ids" value={id} />
                ))}
                <strong>{visibleChecked.length} selected</strong>
                <input
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  placeholder="Follow-up reason"
                  aria-label="Bulk follow-up reason"
                />
                <button type="submit" className={s.primary}>
                  Mark for follow-up
                </button>
                <button type="button" onClick={() => setChecked([])}>
                  Clear
                </button>
              </DashboardActionForm>
            )}
            <footer className={s.pagination}>
              <span>
                {data.total
                  ? `${(data.page - 1) * 25 + 1}–${Math.min(data.page * 25, data.total)}`
                  : "0"}{" "}
                of {data.total} businesses
              </span>
              <div>
                <button
                  disabled={data.page <= 1 || pending}
                  onClick={() => query({ page: String(data.page - 1) })}
                >
                  ← Previous
                </button>
                <span>Page {data.page}</span>
                <button
                  disabled={data.page * 25 >= data.total || pending}
                  onClick={() => query({ page: String(data.page + 1) })}
                >
                  Next →
                </button>
              </div>
            </footer>
          </section>
          <section className={s.panel}>
            <div className={s.sectionHeading}>
              <h2>
                Needs review{" "}
                <span>{data.review_total + data.missing_contact_total}</span>
              </h2>
              <button onClick={() => query({ tab: "review" })}>
                View all →
              </button>
            </div>
            {data.reviews.length ? (
              data.reviews.map((task) => (
                <div className={s.queueRow} key={task.request_id}>
                  <span className={s.taskIcon}>
                    <Icon name="flag" />
                  </span>
                  <div>
                    <button
                      className={s.textButton}
                      onClick={() => open(task.location_id)}
                    >
                      <strong>{task.name}</strong>
                    </button>
                    <small>
                      {task.label} · {date(task.created_at, true)}
                      {task.assignee ? ` · Assigned to ${task.assignee}` : ""}
                    </small>
                  </div>
                  {can(P.locationsUpdateStatus) &&
                    (!task.assigned_user_id ||
                      task.assigned_user_id === actorId) && (
                      <DashboardActionForm
                        className={s.inlineForm}
                        action={takeBusinessReviewAction}
                        onComplete={complete}
                      >
                        <Hidden name="kind" value={task.kind} />
                        <Hidden name="request_id" value={task.request_id} />
                        <button
                          type="submit"
                          disabled={task.assigned_user_id === actorId}
                        >
                          {task.assigned_user_id === actorId ? "Taken" : "Take"}
                        </button>
                      </DashboardActionForm>
                    )}
                  {can(P.dashboardRead) ? (
                    <button
                      className={s.primary}
                      onClick={() => {
                        open(task.location_id);
                        setReviewData(null);
                        setReview(task);
                      }}
                    >
                      Review
                    </button>
                  ) : (
                    <Link
                      href={`/admin/${task.kind === "claims" ? "claims" : "verification"}?q=${encodeURIComponent(task.name)}`}
                    >
                      Review →
                    </Link>
                  )}
                </div>
              ))
            ) : data.missing_contact_total === 0 ? (
              <p className={s.empty}>No requests waiting for review.</p>
            ) : null}
            {data.missing_contacts
              .slice(0, Math.max(0, 3 - data.reviews.length))
              .map((b) => (
                <div className={s.queueRow} key={b.id}>
                  <span className={s.taskIcon}>
                    <Icon name="flag" />
                  </span>
                  <div>
                    <strong>{b.name}</strong>
                    <small>
                      Missing contact information · {b.assignee || "Unassigned"}
                    </small>
                  </div>
                  {can(P.locationsUpdateStatus) && !b.marked && (
                    <DashboardActionForm
                      className={s.inlineForm}
                      action={saveDashboardFollowupAction}
                      onComplete={complete}
                    >
                      <Hidden name="kind" value="location" />
                      <Hidden name="target_id" value={b.id} />
                      <Hidden
                        name="reason"
                        value="Review missing business contact information"
                      />
                      <Hidden name="assigned_user_id" value={actorId} />
                      <button type="submit">Take</button>
                    </DashboardActionForm>
                  )}
                  <button
                    className={s.primary}
                    onClick={() => open(b.id, "edit")}
                  >
                    Review
                  </button>
                </div>
              ))}
          </section>
          <section className={s.panel}>
            <div className={s.sectionHeading}>
              <h2>
                Follow-up today <span>{data.followup_due_total}</span>
              </h2>
              <button onClick={() => query({ tab: "followup" })}>
                View all →
              </button>
            </div>
            {data.followups.length ? (
              data.followups.map((b) => (
                <div className={s.queueRow} key={b.id}>
                  <span className={s.taskIcon}>
                    <Icon name="flag" />
                  </span>
                  <div>
                    <strong>{b.name}</strong>
                    <small>{b.followup_reason}</small>
                    <small>
                      {b.assignee || "Unassigned"} ·{" "}
                      {b.due_at ? `Due ${date(b.due_at)}` : "No due date"}
                      {b.due_at && b.overdue ? " · Overdue" : ""}
                    </small>
                  </div>
                  <button onClick={() => open(b.id, "followup")}>
                    Review →
                  </button>
                </div>
              ))
            ) : (
              <p className={s.empty}>No follow-ups due today.</p>
            )}
          </section>
          <section className={`${s.panel} ${s.quick}`}>
            <strong>Quick actions</strong>
            {can(P.reportsCreate) && (
              <Link href="/admin/reports#create-case">Create case</Link>
            )}
            {can(P.usersRead) && <Link href="/admin/users">Find owner</Link>}
            {selected && (
              <Link href={`/explore/salons/${selected}`} target="_blank">
                Open public profile ↗
              </Link>
            )}
            <Link href="/admin/attention?kind=location">Attention list →</Link>
          </section>
        </div>
        {selected && (
          <aside
            ref={drawerRef}
            className={s.drawer}
            aria-label="Business details"
          >
            <div className={s.drawerHeader}>
              <div className={s.avatar}>
                {row ? initials(row.name) : <Icon name="store" />}
              </div>
              <div>
                <h2>{row?.name || "Business details"}</h2>
                {row && <Badge value={row.status} />}
              </div>
              <button aria-label="Close business details" onClick={close}>
                <Icon name="close" />
              </button>
            </div>
            {error && (
              <div role="alert" className={s.error}>
                {error}
                <button onClick={() => setVersion((v) => v + 1)}>Retry</button>
              </div>
            )}
            {!row && !error && (
              <p role="status" className={s.empty}>
                Loading business details…
              </p>
            )}
            {row && record && (
              <>
                <div className={s.identity}>
                  <Link href={record.href}>Open full profile ↗</Link>
                  <dl>
                    <dt>Address</dt>
                    <dd>{address(row) || "Not provided"}</dd>
                    <dt>Phone</dt>
                    <dd>{row.phone || "Not provided"}</dd>
                    <dt>Owner</dt>
                    <dd>
                      {row.owners.length
                        ? row.owners.map((o) => (
                            <Link key={o.id} href={`/admin/users/${o.id}`}>
                              {o.name}{" "}
                            </Link>
                          ))
                        : can(P.usersRead)
                          ? "No linked owner"
                          : "Restricted by your role"}
                    </dd>
                    <dt>Created by</dt>
                    <dd>
                      {row.creator ? (
                        <Link href={`/admin/users/${row.creator.id}`}>
                          {row.creator.name}
                        </Link>
                      ) : (
                        "Not recorded or restricted"
                      )}
                    </dd>
                    <dt>Created</dt>
                    <dd>{date(row.created_at)}</dd>
                  </dl>
                  <div className={s.badges}>
                    <Badge value={row.ownership} />
                    <Badge
                      value={row.verification}
                      label={verification(row.verification)}
                    />
                  </div>
                </div>
                <nav
                  className={s.detailTabs}
                  aria-label="Business details tabs"
                >
                  {["overview", "activity", "notes"]
                    .filter(
                      (t) =>
                        t === "overview" ||
                        can(t === "activity" ? P.auditRead : P.notesRead) ||
                        (t === "notes" && can(P.notesCreate)),
                    )
                    .map((t) => (
                      <button
                        key={t}
                        aria-current={mode === t ? "page" : undefined}
                        onClick={() => {
                          setMode(t);
                          setReview(null);
                        }}
                      >
                        {t}
                      </button>
                    ))}
                </nav>
                <div className={s.drawerBody}>
                  {record.errors.map((e) => (
                    <p key={e} className={s.error} role="alert">
                      {e}
                    </p>
                  ))}
                  {review ? (
                    <>
                      {reviewData ? (
                        <DashboardDetailPanel
                          data={reviewData}
                          item={{
                            id: review.request_id,
                            kind: review.kind,
                            title: review.name,
                            reference: review.label,
                            preview: "",
                            status: "waiting",
                            priority: "normal",
                            createdAt: review.created_at,
                            assignedUserId: review.assigned_user_id,
                            assignee: review.assignee,
                            href: `/admin/${review.kind === "claims" ? "claims" : "verification"}`,
                          }}
                          onComplete={complete}
                        />
                      ) : (
                        !error && <p>Loading review…</p>
                      )}
                      <button onClick={() => setReview(null)}>
                        Back to business
                      </button>
                    </>
                  ) : (
                    <>
                      {(mode === "overview" || mode === "edit") && (
                        <section>
                          <div className={s.sectionHeading}>
                            <h3>Business details</h3>
                            {can(P.locationsUpdate) && (
                              <button
                                onClick={() =>
                                  setMode(mode === "edit" ? "overview" : "edit")
                                }
                              >
                                {mode === "edit"
                                  ? "Cancel"
                                  : "Edit information"}
                              </button>
                            )}
                          </div>
                          {mode === "edit" ? (
                            <DashboardActionForm
                              key={row.updated_at}
                              className={s.form}
                              action={updateAdminLocationProfileAction}
                              onComplete={complete}
                            >
                              <Hidden name="location_id" value={row.id} />
                              {(
                                [
                                  "name",
                                  "phone",
                                  "address_line1",
                                  "address_line2",
                                  "city",
                                  "state",
                                  "postal_code",
                                  "country",
                                ] as const
                              ).map((field) => (
                                <label key={field}>
                                  {field.replaceAll("_", " ")}
                                  <input
                                    name={field}
                                    defaultValue={row[field] || ""}
                                    required={
                                      field === "name" || field === "country"
                                    }
                                    maxLength={field === "country" ? 2 : 200}
                                  />
                                </label>
                              ))}
                              <label>
                                Reason for change
                                <textarea
                                  name="reason"
                                  required
                                  minLength={3}
                                  maxLength={1000}
                                />
                              </label>
                              <button className={s.primary} type="submit">
                                Save information
                              </button>
                            </DashboardActionForm>
                          ) : (
                            <dl>
                              <dt>Business name</dt>
                              <dd>{row.name}</dd>
                              <dt>Address</dt>
                              <dd>{address(row) || "Not provided"}</dd>
                              <dt>Phone</dt>
                              <dd>{row.phone || "Not provided"}</dd>
                              <dt>Last updated</dt>
                              <dd>{date(row.updated_at)}</dd>
                            </dl>
                          )}
                        </section>
                      )}
                      {mode === "overview" && (
                        <section>
                          <h3>Ownership & verification</h3>
                          <div className={s.badges}>
                            <Badge value={row.ownership} />
                            <Badge
                              value={row.verification}
                              label={verification(row.verification)}
                            />
                          </div>
                          <p>
                            Ownership requests and identity verification are
                            reviewed separately.
                          </p>
                          <div className={s.links}>
                            <Link
                              href={`/admin/claims?q=${encodeURIComponent(row.name)}&status=all`}
                            >
                              Ownership history →
                            </Link>
                            <Link
                              href={`/admin/verification?q=${encodeURIComponent(row.name)}&status=all`}
                            >
                              Verification history →
                            </Link>
                            {row.account_id && (
                              <Link
                                href={`/admin/businesses/${row.account_id}`}
                              >
                                Manage shared access →
                              </Link>
                            )}
                          </div>
                        </section>
                      )}
                      {(mode === "overview" || mode === "followup") && (
                        <section>
                          <h3>Follow-up</h3>
                          {can(P.locationsUpdateStatus) &&
                          !record.errors.some((e) =>
                            e.startsWith("Follow-up"),
                          ) ? (
                            <DashboardActionForm
                              key={record.followup?.updated_at || row.id}
                              className={s.form}
                              action={saveDashboardFollowupAction}
                              onComplete={complete}
                            >
                              <Hidden name="kind" value="location" />
                              <Hidden name="target_id" value={row.id} />
                              <Hidden
                                name="expected_updated_at"
                                value={record.followup?.updated_at || null}
                              />
                              <label>
                                Reason
                                <textarea
                                  name="reason"
                                  required
                                  minLength={3}
                                  maxLength={1000}
                                  defaultValue={record.followup?.reason || ""}
                                  placeholder="What needs checking?"
                                />
                              </label>
                              <div className={s.formGrid}>
                                <label>
                                  Assigned to
                                  <select
                                    name="assigned_user_id"
                                    defaultValue={
                                      record.followup?.assigned_user_id || ""
                                    }
                                  >
                                    <option value="">Unassigned</option>
                                    {record.assignees.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                    {record.followup?.assigned_user_id &&
                                      !record.assignees.some(
                                        (a) =>
                                          a.id ===
                                          record.followup?.assigned_user_id,
                                      ) && (
                                        <option
                                          value={
                                            record.followup.assigned_user_id
                                          }
                                        >
                                          {record.followup.assignee ||
                                            "Current assignee"}
                                        </option>
                                      )}
                                  </select>
                                </label>
                                <label>
                                  Due date (your local time)
                                  <input
                                    name="due_at"
                                    type="datetime-local"
                                    defaultValue={
                                      record.followup?.due_at
                                        ? new Date(
                                            Date.parse(record.followup.due_at) -
                                              new Date(
                                                record.followup.due_at,
                                              ).getTimezoneOffset() *
                                                60000,
                                          )
                                            .toISOString()
                                            .slice(0, 16)
                                        : ""
                                    }
                                  />
                                </label>
                              </div>
                              <button type="submit" className={s.primary}>
                                Save follow-up
                              </button>
                            </DashboardActionForm>
                          ) : (
                            <p>
                              {record.followup?.reason ||
                                "No follow-up scheduled."}
                            </p>
                          )}
                          {record.followup && can(P.locationsUpdateStatus) && (
                            <DashboardActionForm
                              className={s.form}
                              action={dashboardAccountAction}
                              confirmMessage="Mark this follow-up as reviewed and remove it from the attention list?"
                              onComplete={complete}
                            >
                              <Hidden name="kind" value="location" />
                              <Hidden name="target_id" value={row.id} />
                              <Hidden name="operation" value="unmark" />
                              <label>
                                Review outcome
                                <textarea
                                  name="reason"
                                  required
                                  minLength={3}
                                  maxLength={1000}
                                />
                              </label>
                              <button type="submit">Mark reviewed ✓</button>
                            </DashboardActionForm>
                          )}
                        </section>
                      )}
                      {mode === "status" && can(P.locationsUpdateStatus) && (
                        <section>
                          <h3>
                            {row.status === "active" ? "Disable" : "Restore"}{" "}
                            business
                          </h3>
                          <p>
                            This changes this business’s activity status. The
                            owner’s account is managed separately.
                          </p>
                          <DashboardActionForm
                            className={s.form}
                            action={businessStatusAction}
                            confirmMessage={`${row.status === "active" ? "Disable" : "Restore"} ${row.name}?`}
                            onComplete={complete}
                          >
                            <Hidden name="kind" value="location" />
                            <Hidden name="target_id" value={row.id} />
                            <Hidden
                              name="status"
                              value={
                                row.status === "active" ? "inactive" : "active"
                              }
                            />
                            <Hidden name="expected_status" value={row.status} />
                            <label>
                              Reason
                              <textarea
                                name="reason"
                                required
                                minLength={3}
                                maxLength={1000}
                              />
                            </label>
                            <button className={s.primary} type="submit">
                              {row.status === "active" ? "Disable" : "Restore"}{" "}
                              business
                            </button>
                          </DashboardActionForm>
                        </section>
                      )}
                      {(mode === "overview" || mode === "activity") &&
                        can(P.auditRead) && (
                          <section>
                            <div className={s.sectionHeading}>
                              <h3>Recent activity</h3>
                              <Link href={`/admin/audit?targetId=${row.id}`}>
                                View all →
                              </Link>
                            </div>
                            {record.activity
                              .slice(0, mode === "overview" ? 3 : 20)
                              .map((a) => (
                                <article className={s.activity} key={a.id}>
                                  <strong>{a.title}</strong>
                                  <small>
                                    {a.actor} · {date(a.createdAt)}
                                  </small>
                                  {a.reason && <p>{a.reason}</p>}
                                </article>
                              ))}
                            {!record.activity.length && (
                              <p>No recorded activity.</p>
                            )}
                          </section>
                        )}
                      {(mode === "overview" || mode === "notes") &&
                        (can(P.notesRead) || can(P.notesCreate)) && (
                          <section>
                            <h3>Internal notes</h3>
                            {can(P.notesRead) &&
                              record.notes
                                .slice(0, mode === "overview" ? 2 : 20)
                                .map((n) => (
                                  <article className={s.activity} key={n.id}>
                                    <p>{n.body}</p>
                                    <small>
                                      {n.author?.display_name || "Admin"} ·{" "}
                                      {date(n.created_at)}
                                    </small>
                                  </article>
                                ))}
                            {can(P.notesCreate) && (
                              <DashboardActionForm
                                className={s.form}
                                action={createAdminNoteAction}
                                onComplete={complete}
                                resetOnSuccess
                              >
                                <Hidden name="target_type" value="location" />
                                <Hidden name="target_id" value={row.id} />
                                <Hidden
                                  name="return_path"
                                  value="/admin/locations"
                                />
                                <label>
                                  Add note
                                  <textarea
                                    name="body"
                                    required
                                    maxLength={5000}
                                    placeholder="Add context for your team…"
                                  />
                                </label>
                                <button type="submit">Add note</button>
                              </DashboardActionForm>
                            )}
                          </section>
                        )}
                    </>
                  )}
                </div>
                <footer className={s.drawerFooter}>
                  {can(P.locationsUpdate) && (
                    <button
                      className={s.primary}
                      onClick={() => {
                        setReview(null);
                        setMode("edit");
                      }}
                    >
                      Edit business
                    </button>
                  )}
                  {can(P.locationsUpdateStatus) && (
                    <>
                      <button
                        onClick={() => {
                          setReview(null);
                          setMode("status");
                        }}
                      >
                        <Icon name="lock" />
                        {row.status === "active" ? "Disable" : "Restore"}{" "}
                        business
                      </button>
                      <button
                        onClick={() => {
                          setReview(null);
                          setMode("followup");
                        }}
                      >
                        <Icon name="flag" />
                        Follow-up
                      </button>
                    </>
                  )}
                </footer>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

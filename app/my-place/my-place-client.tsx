"use client";

import type { PendingOwnerTransferInvite } from "@/lib/owner-transfer";
import { respondOwnerInvite } from "./owner-invite-actions";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { QueryErrorDialog } from "@/app/query-error-dialog";
import { switchWorkspaceDestination } from "@/app/salons/actions";
import type {
  CurrentWorkspaceAction,
  CurrentWorkspaceOption as Workspace,
} from "@/lib/current-context";
import { normalizeSearchText } from "@/lib/search-normalization";
import { workspaceSearchText } from "@/app/workspace-display";
import type { KingUser } from "@/types/user";
import type { Location } from "@/types/location";
import type { PlaceRequest, PlaceResult } from "@/types/my-place";
import {
  Avatar,
  Notice,
  Section,
  button,
  inputClass,
  primaryButton,
} from "./place-ui";
import { respondPlaceRequest } from "./actions";
import {
  ApplyPanel,
  CreateSalonPanel,
  SalonDetailsPanel,
  placeAddress,
} from "./place-panels";
import { AccountRow, CurrentBadge } from "./place-account";
import { RequestRow } from "./place-requests";
import { PlaceLifecyclePanel } from "./place-lifecycle";
import { placeShortcuts } from "./place-shortcuts";

type Props = {
  currentWorkspace: Workspace | null;
  user: KingUser;
  phoneVerified: boolean;
  error?: string;
  workspaceOptions: Workspace[];
  salons: Location[];
  requests: PlaceResult<PlaceRequest[]>;
  ownerInvites: PendingOwnerTransferInvite[];
  ownerInvitesError?: string;
};
type Panel =
  | { type: "create"; accountId?: string }
  | { type: "salon" | "activity"; workspace: Workspace }
  | { type: "apply" };
const textLink =
  "inline-flex min-h-8 items-center text-xs font-medium text-zinc-500 underline-offset-4 hover:text-[#d65c2b] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f26f3d]";

export function MyPlaceClient({
  currentWorkspace,
  user,
  phoneVerified,
  error,
  workspaceOptions,
  salons,
  requests,
  ownerInvites,
  ownerInvitesError,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(error ? { text: error, error: true } : null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const lock = useRef(false);
  const normalized = normalizeSearchText(query);
  const matches = (w: Workspace) =>
    !normalized ||
    normalizeSearchText(
      `${workspaceSearchText(w)} ${placeAddress(salons.find((s) => s.id === w.salonId))}`,
    ).includes(normalized);
  const owners = workspaceOptions.filter(
    (w) => w.type === "salon" && w.salonMode === "manage" && matches(w),
  );
  const staff = workspaceOptions.filter(
    (w) => w.type === "salon" && w.salonMode === "staff" && matches(w),
  );
  const accounts = workspaceOptions.filter((w) => w.type === "account");
  const createAccounts = accounts.filter((w) =>
    w.menuActions.some((a) => a.id === "create-salon"),
  );
  const requestList = requests.ok
    ? requests.data.filter(
        (r) =>
          !normalized ||
          normalizeSearchText(
            `${r.label} ${r.detail ?? ""} ${r.message ?? ""}`,
          ).includes(normalized),
      )
    : [];
  const isPersonalRequest = (r: PlaceRequest) =>
    r.kind === "invitation" || r.kind === "application";
  const staffRequests = requestList.filter(
    (r) => r.status === "pending" && isPersonalRequest(r),
  );
  const salonRequests = requestList.filter(
    (r) => r.status === "pending" && !isPersonalRequest(r),
  );
  const historyRequests = requestList.filter((r) => r.status !== "pending");

  function complete(text: string) {
    setNotice({ text });
    router.refresh();
  }
  function run(workspace: Workspace, action: CurrentWorkspaceAction) {
    if (lock.current) return;
    lock.current = true;
    setPendingId(workspace.id);
    startTransition(async () => {
      try {
        const result = await switchWorkspaceDestination({
          workspaceId: workspace.id,
          destinationHref: action.href,
        });
        if (!result.ok) setNotice({ text: result.message, error: true });
        else {
          router.push(result.href);
          router.refresh();
        }
      } catch {
        setNotice({
          text: "Unable to open this workspace. Please try again.",
          error: true,
        });
      } finally {
        lock.current = false;
        setPendingId(null);
      }
    });
  }
  function requestAction(id: string, operation: string) {
    if (lock.current) return;
    lock.current = true;
    setPendingId(id);
    startTransition(async () => {
      try {
        const result = await respondPlaceRequest(id, operation);
        if (!result.ok) setNotice({ text: result.message, error: true });
        else complete("Request updated.");
      } catch {
        setNotice({
          text: "Unable to update this request. Please try again.",
          error: true,
        });
      } finally {
        lock.current = false;
        setPendingId(null);
      }
    });
  }
  function requestRows(items: PlaceRequest[]) {
    return items.length ? (
      <details open className="border-t border-[#f1ebe6] px-4 py-2 sm:px-5">
        <summary className="cursor-pointer py-1 text-xs font-semibold text-[#ad542d]">
          Requests & invitations ({items.length})
        </summary>
        <div className="divide-y divide-[#f1ebe6]">
          {items.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              disabled={busy}
              pending={pendingId === r.id}
              onAction={requestAction}
            />
          ))}
        </div>
      </details>
    ) : null;
  }
  function salonRow(workspace: Workspace) {
    const salon = salons.find((s) => s.id === workspace.salonId);
    const managing = workspace.salonMode === "manage";
    const closed = salon?.status === "permanently_closed";
    const active = salon?.status === "active";
    const canToggle =
      managing &&
      workspace.roleCode?.toUpperCase() === "OWNER" &&
      !closed &&
      Boolean(salon);
    const links = placeShortcuts(workspace).filter(
      (link) =>
        !managing ||
        active ||
        !["Booking settings", "POS settings"].includes(link.label),
    );
    const shortAddress = salon
      ? [salon.city, salon.state].filter(Boolean).join(", ")
      : "";
    return (
      <div key={workspace.id} className="px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar workspace={workspace} />
          <div className="min-w-0 flex-1 basis-36">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-sm font-bold text-[#302a28]">
                {workspace.label}
              </h3>
              {currentWorkspace?.id === workspace.id ? <CurrentBadge /> : null}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {workspace.roleLabel}
              {shortAddress ? ` · ${shortAddress}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {managing && salon ? (
              canToggle ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-label={`Salon activity for ${workspace.label}`}
                  disabled={busy}
                  onClick={() => setPanel({ type: "activity", workspace })}
                  className="mr-2 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f26f3d]"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-9 items-center rounded-full px-0.5 ${active ? "justify-end bg-teal-600" : "justify-start bg-zinc-300"}`}
                  >
                    <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
                  </span>
                  {active ? "Active" : "Temporarily paused"}
                </button>
              ) : (
                <span className="mr-2 text-xs font-medium text-zinc-500">
                  {closed
                    ? "Permanently closed"
                    : active
                      ? "Active"
                      : "Temporarily paused"}
                </span>
              )
            ) : null}
            <button
              className={button}
              disabled={busy}
              onClick={() => setPanel({ type: "salon", workspace })}
            >
              Details
            </button>
            {workspace.primaryAction ? (
              <button
                className={managing ? primaryButton : button}
                disabled={busy}
                onClick={() => run(workspace, workspace.primaryAction!)}
              >
                {pendingId === workspace.id ? "Opening…" : "Open workspace"}
              </button>
            ) : null}
          </div>
        </div>
        <nav
          aria-label={`Shortcuts for ${workspace.label}`}
          className="mt-1 flex flex-wrap items-center gap-x-4 sm:pl-14"
        >
          {managing && workspace.roleCode === "OWNER" ? (
            <Link
              href="/pos/portable"
              prefetch={false}
              className={textLink}
              title="Open Portable using your salon?s Portable ID and access code"
            >
              Portable
            </Link>
          ) : null}
          {links.slice(0, 3).map((link) => (
            <a key={link.label} className={textLink} href={link.href}>
              {link.label}
            </a>
          ))}
          {links.length > 3 ? (
            <details className="group">
              <summary className={`${textLink} cursor-pointer`}>
                More settings
              </summary>
              <div className="flex flex-wrap gap-x-4">
                {links.slice(3).map((link) => (
                  <a key={link.label} className={textLink} href={link.href}>
                    {link.label}
                  </a>
                ))}
              </div>
            </details>
          ) : null}
        </nav>
      </div>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="text-xl font-bold tracking-tight text-[#302a28]">
          My Place
        </h1>
        <div className="relative w-full sm:max-w-xs">
          <input
            aria-label="Search My Place"
            className={`${inputClass} pr-16`}
            placeholder="Search your places…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="absolute inset-y-0 right-3 text-xs font-semibold text-zinc-600"
              onClick={() => setQuery("")}
            >
              Clear
            </button>
          ) : null}
        </div>
      </header>
      <AccountProfileEditor
        key={user.updated_at}
        user={user}
        compact
        phoneVerified={phoneVerified}
        createdAtLabel={new Date(user.created_at).toLocaleDateString("en-US", {
          timeZone: "UTC",
        })}
      />
      {notice?.error ? <QueryErrorDialog key={notice.text} message={notice.text} title="Could not complete this action" primaryLabel="Got it" /> : notice ? <Notice>{notice.text}</Notice> : null}
      {!requests.ok ? (
        <Notice error>
          Requests could not be loaded. {requests.message}{" "}
          <button className="ml-2 underline" onClick={() => router.refresh()}>
            Retry
          </button>
        </Notice>
      ) : null}

      <Section
        title="Staff"
        count={staff.length}
        action={
          <div className="flex items-center gap-4">
            <button
              className={button}
              onClick={() => setPanel({ type: "apply" })}
            >
              Find a salon
            </button>
          </div>
        }
      >
        {staff.length ? (
          <div className="divide-y divide-[#f1ebe6]">{staff.map(salonRow)}</div>
        ) : (
          <p className="px-5 py-3 text-sm text-zinc-500">
            {normalized
              ? "No matching staff workplaces."
              : "Not working at a salon yet? Find a salon to apply."}
          </p>
        )}
        {requestRows(staffRequests)}
        {historyRequests.length ? (
          <details className="border-t border-[#f1ebe6] px-5 py-2">
            <summary className={`${textLink} cursor-pointer`}>
              Connection history ({historyRequests.length})
            </summary>
            {historyRequests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                disabled={busy}
                pending={false}
                onAction={requestAction}
              />
            ))}
          </details>
        ) : null}
      </Section>

      <Section
        title="Salon / Business"
        count={owners.length + ownerInvites.length}
        action={
          createAccounts.length ? (
            <button
              className={button}
              onClick={() => setPanel({ type: "create" })}
            >
              ＋ Create salon
            </button>
          ) : null
        }
      >
        {owners.length ? (
          [...new Set(owners.map((w) => w.accountId))].map((accountId) => (
            <div key={accountId ?? "salons"}>
              {accounts.length > 1 ? (
                <p className="bg-[#fcfaf8] px-5 py-1.5 text-xs font-semibold text-zinc-500">
                  {owners.find((w) => w.accountId === accountId)?.accountName}
                </p>
              ) : null}
              <div className="divide-y divide-[#f1ebe6]">
                {owners.filter((w) => w.accountId === accountId).map(salonRow)}
              </div>
            </div>
          ))
        ) : (
          <p className="px-5 py-3 text-sm text-zinc-500">
            {normalized
              ? "No matching salons."
              : "Your owned and managed salons will appear here."}
          </p>
        )}
        {ownerInvitesError ? <Notice error>{ownerInvitesError} <button type="button" className="ml-2 underline" onClick={() => router.refresh()}>Retry</button></Notice> : null}
        {ownerInvites.filter((invite) => !normalized || normalizeSearchText(invite.salonName).includes(normalized)).map((invite) => (
          <div key={invite.id} className="border-t border-[#f1ebe6] px-5 py-4">
            <p className="text-sm font-semibold">{invite.salonName}</p>
            <p className="mt-1 text-sm text-zinc-500">{invite.mode === "transfer_ownership" ? "Ownership transfer · Needs acceptance" : "Co-owner invitation · Needs acceptance"}</p>
            {invite.message ? <p className="mt-1 text-sm">{invite.message}</p> : null}
            <div className="mt-3 flex gap-2">
              {(["accept", "ignore"] as const).map((response) => (
                <button key={response} className={response === "accept" ? primaryButton : button} disabled={busy} onClick={() => {
                  if (lock.current) return;
                  lock.current = true;
                  startTransition(async () => {
                    try {
                      const result = await respondOwnerInvite(invite.id, response);
                      if (result.error) setNotice({ text: result.error, error: true });
                      else complete(response === "accept" ? "Owner invitation accepted." : "Owner invitation ignored.");
                    } finally { lock.current = false; }
                  });
                }}>{response === "accept" ? "Accept" : "Ignore"}</button>
              ))}
            </div>
          </div>
        ))}
        {requestRows(salonRequests)}
        {accounts.length ? (
          <details className="border-t border-[#f1ebe6] px-5 py-2">
            <summary className={`${textLink} cursor-pointer`}>
              Business accounts & access
            </summary>
            <div className="divide-y divide-[#f1ebe6]">
              {accounts.filter(matches).map((w) => (
                <AccountRow
                  key={w.id}
                  workspace={w}
                  current={currentWorkspace?.id === w.id}
                  salons={workspaceOptions.filter(
                    (s) =>
                      s.salonMode === "manage" && s.accountId === w.accountId,
                  )}
                  onCreate={() => setPanel({ type: "create", accountId: w.id })}
                  onNotice={complete}
                  onSalon={(workspace) =>
                    setPanel({ type: "salon", workspace })
                  }
                />
              ))}
            </div>
          </details>
        ) : null}
      </Section>
      {panel?.type === "create" ? (
        <CreateSalonPanel
          accounts={createAccounts}
          initialAccount={
            panel.accountId ??
            createAccounts.find(
              (w) => w.accountId === currentWorkspace?.accountId,
            )?.id
          }
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            complete("Salon created. Open its workspace when you’re ready.");
          }}
        />
      ) : null}
      {panel?.type === "salon" ? (
        <SalonDetailsPanel
          key={panel.workspace.id}
          workspace={
            workspaceOptions.find((w) => w.id === panel.workspace.id) ??
            panel.workspace
          }
          onClose={() => setPanel(null)}
          onSaved={complete}
        />
      ) : null}
      {panel?.type === "activity" ? (
        <PlaceLifecyclePanel
          key={panel.workspace.id}
          workspace={panel.workspace}
          onClose={() => setPanel(null)}
          onSaved={complete}
        />
      ) : null}
      {panel?.type === "apply" ? (
        <ApplyPanel
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            complete("Application sent. Track it in the Staff section.");
          }}
        />
      ) : null}
    </main>
  );
}

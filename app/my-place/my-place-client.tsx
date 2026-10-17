"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { PendingOwnerTransferInvite } from "@/lib/owner-transfer";
import { respondOwnerInvite } from "./owner-invite-actions";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { QueryErrorDialog } from "@/app/query-error-dialog";
import { navigateToWorkspace } from "@/lib/workspace-navigation";
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
  const __vt = useWorkspaceTranslation();

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
        navigateToWorkspace(workspace.id, action.href);
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
          <WorkspaceText text="Requests & invitations (" />{items.length})
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
      <div key={workspace.id} className="px-4 py-3 sm:px-5" data-place-salon={workspace.id}>
        <div className="flex min-w-0 items-start gap-3">
          <Avatar workspace={workspace} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-sm font-medium text-zinc-950"><WorkspaceText text={workspace.label} /></h3>
              {currentWorkspace?.id === workspace.id ? <CurrentBadge /> : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 text-xs text-zinc-500">
              <span><WorkspaceText text={workspace.roleLabel} /></span>
              {workspace.primaryAction ? <button className="inline-flex min-h-9 items-center text-xs text-orange-600 disabled:opacity-50" disabled={busy} onClick={() => run(workspace, workspace.primaryAction!)}><WorkspaceText text={pendingId === workspace.id ? "Opening…" : "Switch"} /></button> : null}
              {shortAddress ? <span>{shortAddress}</span> : null}
            </div>
            {managing && salon ? canToggle ? (
              <button type="button" role="switch" aria-checked={active} aria-label={__vt(`Salon activity for ${workspace.label}`)} disabled={busy}
                onClick={() => setPanel({ type: "activity", workspace })}
                className="inline-flex min-h-9 items-center gap-2 text-xs text-zinc-600 disabled:opacity-50">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${active ? "bg-teal-600" : "bg-zinc-400"}`} />
                <WorkspaceText text={active ? "Active" : "Temporarily paused"} /><span aria-hidden="true">⌄</span>
              </button>
            ) : <span className="block py-1 text-xs text-zinc-500"><WorkspaceText text={closed ? "Permanently closed" : active ? "Active" : "Temporarily paused"} /></span> : null}
          </div>
        </div>
        <nav aria-label={__vt(`Shortcuts for ${workspace.label}`)} className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0" data-place-shortcuts>
          {managing && workspace.roleCode === "OWNER" ? <Link href="/pos/portable" prefetch={false} className={textLink} title={__vt("Open Portable using your salon?s Portable ID and access code")}><WorkspaceText text="Portable" /></Link> : null}
          {links.map(link => <a key={link.label} className={textLink} href={link.href}><WorkspaceText text={link.label} /></a>)}
          <button className={textLink} disabled={busy} onClick={() => setPanel({ type: "salon", workspace })}><WorkspaceText text="Details" /></button>
        </nav>
      </div>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-2 bg-zinc-50 pb-4 sm:px-6 lg:px-8">
      <header className="flex min-w-0 items-center justify-between gap-3 bg-white px-4 py-3">
        <h1 className="shrink-0 text-sm font-medium text-zinc-950">
          <WorkspaceText text="My Place" />
        </h1>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <input
            aria-label={__vt("Search My Place")}
            className={`${inputClass} pr-16`}
            placeholder={__vt("Search your places…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              aria-label={__vt("Clear search")}
              className="absolute inset-y-0 right-3 text-xs font-semibold text-zinc-600"
              onClick={() => setQuery("")}
            >
              <WorkspaceText text="Clear" />
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
      {notice?.error ? <QueryErrorDialog key={notice.text} message={notice.text} title={__vt("Could not complete this action")} primaryLabel="Got it" /> : notice ? <Notice><WorkspaceText text={notice.text} /></Notice> : null}
      {!requests.ok ? (
        <Notice error>
          <WorkspaceText text="Requests could not be loaded." /> <WorkspaceText text={requests.message} />{" "}
          <button className="ml-2 underline" onClick={() => router.refresh()}>
            <WorkspaceText text="Retry" />
          </button>
        </Notice>
      ) : null}

      <Section
        title={__vt("Businesses")}
        count={owners.length + ownerInvites.length}
        action={
          createAccounts.length ? (
            <button
              className="min-h-11 text-xs text-orange-600"
              onClick={() => setPanel({ type: "create" })}
            >
              <WorkspaceText text="＋ Create salon" />
            </button>
          ) : null
        }
      >
        {owners.length ? (
          <div className="divide-y divide-[#f1ebe6]">{owners.map(salonRow)}</div>
        ) : (
          <p className="px-5 py-3 text-sm text-zinc-500">
            <WorkspaceText text={normalized
              ? "No matching salons."
              : "Your owned and managed salons will appear here."} />
          </p>
        )}
        {ownerInvitesError ? <Notice error><WorkspaceText text={ownerInvitesError} /> <button type="button" className="ml-2 underline" onClick={() => router.refresh()}><WorkspaceText text="Retry" /></button></Notice> : null}
        {ownerInvites.filter((invite) => !normalized || normalizeSearchText(invite.salonName).includes(normalized)).map((invite) => (
          <div key={invite.id} className="border-t border-[#f1ebe6] px-5 py-4">
            <p className="text-sm font-semibold">{invite.salonName}</p>
            <p className="mt-1 text-sm text-zinc-500"><WorkspaceText text={invite.mode === "transfer_ownership" ? "Ownership transfer · Needs acceptance" : "Co-owner invitation · Needs acceptance"} /></p>
            {invite.message ? <p className="mt-1 text-sm"><WorkspaceText text={invite.message} /></p> : null}
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
                }}><WorkspaceText text={response === "accept" ? "Accept" : "Ignore"} /></button>
              ))}
            </div>
          </div>
        ))}
        {requestRows(salonRequests)}
        {accounts.length ? (
          <details className="border-t border-[#f1ebe6] px-5 py-2">
            <summary className={`${textLink} cursor-pointer`}>
              <WorkspaceText text="Shared access & invitations" />
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
      <Section
        title={__vt("Staff")}
        count={staff.length}
        action={
          <div className="flex items-center gap-4">
            <button
              className="min-h-11 text-xs text-orange-600"
              onClick={() => setPanel({ type: "apply" })}
            >
              <WorkspaceText text="Find & apply to a salon" />
            </button>
          </div>
        }
      >
        {staff.length ? (
          <div className="divide-y divide-[#f1ebe6]">{staff.map(salonRow)}</div>
        ) : (
          <p className="px-5 py-3 text-sm text-zinc-500">
            <WorkspaceText text={normalized
              ? "No matching staff workplaces."
              : "Not working at a salon yet? Find a salon to apply."} />
          </p>
        )}
        {requestRows(staffRequests)}
        {historyRequests.length ? (
          <details className="border-t border-[#f1ebe6] px-5 py-2">
            <summary className={`${textLink} cursor-pointer`}>
              <WorkspaceText text="Connection history (" />{historyRequests.length})
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

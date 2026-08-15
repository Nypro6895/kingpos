"use client";

import { ActionDialog } from "@/app/action-dialog";
import { switchWorkspaceDestination } from "@/app/salons/actions";
import {
  CurrentWorkspaceCard,
  HubIcon,
  QuickAccessItem,
  SearchField,
  WorkspaceGroup,
  WorkspaceGroupEmpty,
  WorkspaceListItem,
  hubButtonClass,
  type RunWorkspaceAction,
} from "@/app/workspace-hub-ui";
import {
  actionKey,
  buildWorkspaceShortcuts,
  workspaceSearchText,
} from "@/app/workspace-display";
import type {
  CurrentWorkspaceAction,
  CurrentWorkspaceOption,
} from "@/lib/current-context";
import type { WorkspacePendingSummary } from "@/lib/workspace-pending";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type RefObject,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

type QuickWorkspacePanelProps = {
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  isOpen: boolean;
  notificationSummary: WorkspacePendingSummary;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  workspaceOptions: CurrentWorkspaceOption[];
};

export function QuickWorkspacePanel({
  accountLabel,
  currentWorkspace,
  isOpen,
  notificationSummary,
  onClose,
  returnFocusRef,
  workspaceOptions,
}: QuickWorkspacePanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;
  const currentWorkspaceId = currentWorkspace?.id ?? null;

  const matchesWorkspace = (workspace: CurrentWorkspaceOption) =>
    !normalizedQuery || workspaceSearchText(workspace).includes(normalizedQuery);

  const manageWorkspaces = workspaceOptions.filter(
    (workspace) =>
      workspace.type === "salon" &&
      workspace.salonMode === "manage" &&
      matchesWorkspace(workspace),
  );
  const staffWorkspaces = workspaceOptions.filter(
    (workspace) =>
      workspace.type === "salon" &&
      workspace.salonMode === "staff" &&
      matchesWorkspace(workspace),
  );
  const accountWorkspaces = workspaceOptions.filter(
    (workspace) => workspace.type === "account" && matchesWorkspace(workspace),
  );
  const quickAccess = buildWorkspaceShortcuts({
    currentWorkspace,
    limit: 4,
    query: normalizedQuery,
    workspaceOptions,
  });
  const pendingMatches =
    notificationSummary.total > 0 &&
    (!normalizedQuery ||
      [
        "pending",
        "notifications",
        "review",
        ...notificationSummary.items.map((item) => item.label),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery));
  const showQuickAccess = quickAccess.length > 0;
  const showManageGroup = !isFiltering || manageWorkspaces.length > 0;
  const showStaffGroup = !isFiltering || staffWorkspaces.length > 0;
  const showAccountGroup = !isFiltering || accountWorkspaces.length > 0;
  const hasDirectoryResults =
    manageWorkspaces.length > 0 ||
    staffWorkspaces.length > 0 ||
    accountWorkspaces.length > 0 ||
    quickAccess.length > 0 ||
    pendingMatches;
  const pendingSeparator = " " + String.fromCharCode(183) + " ";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 0);

    function focusableElements() {
      return Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = focusableElements();

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  function closeAndFocus() {
    onClose();
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  const runAction: RunWorkspaceAction = (
    workspace: CurrentWorkspaceOption,
    action: CurrentWorkspaceAction,
  ) => {
    const key = actionKey(workspace, action);

    if (pendingKey) {
      return;
    }

    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      if (workspace.id === currentWorkspaceId) {
        closeAndFocus();
        router.push(action.href);
        router.refresh();
        setPendingKey(null);
        return;
      }

      const result = await switchWorkspaceDestination({
        destinationHref: action.href,
        workspaceId: workspace.id,
      });

      if (!result.ok) {
        setError(result.message);
        setPendingKey(null);
        return;
      }

      closeAndFocus();
      router.push(result.href);
      router.refresh();
      setPendingKey(null);
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden bg-zinc-950/15 lg:bg-zinc-950/10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeAndFocus();
        }
      }}
    >
      <aside
        aria-labelledby="quick-workspace-title"
        aria-modal="true"
        className="fixed inset-0 flex h-[100dvh] max-w-full flex-col overflow-x-hidden bg-white shadow-2xl lg:inset-y-0 lg:left-16 lg:right-auto lg:h-screen lg:w-[min(480px,calc(100vw-4rem))] lg:border-r lg:border-zinc-200"
        ref={panelRef}
        role="dialog"
      >
        <div className="shrink-0 border-b border-zinc-200 bg-white p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2
                className="truncate text-lg font-semibold text-zinc-950"
                id="quick-workspace-title"
              >
                My Place
              </h2>
              <p className="truncate text-xs text-zinc-500">{accountLabel}</p>
            </div>
            <button
              aria-label="Close My Place"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={closeAndFocus}
              type="button"
            >
              <HubIcon className="h-4 w-4" name="x" />
            </button>
          </div>
          <div className="mt-3">
            <SearchField
              onChange={setQuery}
              onClear={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              placeholder="Search salons and workspaces"
              query={query}
              refCallback={(node) => {
                searchRef.current = node;
              }}
              variant="panel"
            />
          </div>
        </div>

        <div className="grid min-w-0 flex-1 content-start gap-4 overflow-y-auto overflow-x-hidden px-3 py-4">
          {currentWorkspace ? (
            <CurrentWorkspaceCard
              currentWorkspace={currentWorkspace}
              onRunAction={runAction}
              pendingKey={pendingKey}
            />
          ) : null}

          {showQuickAccess ? (
            <WorkspaceGroup
              count={quickAccess.length}
              icon="zap"
              title="Quick Access"
              variant="panel"
            >
              <div className="grid min-w-0 grid-cols-1 gap-2 p-2.5 min-[420px]:grid-cols-2">
                {quickAccess.map((shortcut) => (
                  <QuickAccessItem
                    density="panel"
                    key={shortcut.id}
                    onRunAction={runAction}
                    pendingKey={pendingKey}
                    shortcut={shortcut}
                  />
                ))}
              </div>
            </WorkspaceGroup>
          ) : null}

          {showManageGroup ? (
            <WorkspaceGroup
              count={manageWorkspaces.length}
              icon="store"
              title="Owner Salons"
              variant="panel"
            >
              {manageWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  icon="store"
                  title="No owner salons found."
                  variant="panel"
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {manageWorkspaces.map((workspace) => (
                    <WorkspaceListItem
                      density="panel"
                      key={workspace.id}
                      onRunAction={runAction}
                      pendingKey={pendingKey}
                      workspace={workspace}
                    />
                  ))}
                </div>
              )}
            </WorkspaceGroup>
          ) : null}

          {showStaffGroup ? (
            <WorkspaceGroup
              count={staffWorkspaces.length}
              icon="briefcase"
              title="Staff Workplaces"
              variant="panel"
            >
              {staffWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  icon="briefcase"
                  title="No staff workplaces found."
                  variant="panel"
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {staffWorkspaces.map((workspace) => (
                    <WorkspaceListItem
                      density="panel"
                      key={workspace.id}
                      onRunAction={runAction}
                      pendingKey={pendingKey}
                      workspace={workspace}
                    />
                  ))}
                </div>
              )}
            </WorkspaceGroup>
          ) : null}

          {showAccountGroup ? (
            <WorkspaceGroup
              count={accountWorkspaces.length}
              icon="building"
              title="Accounts"
              variant="panel"
            >
              {accountWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  icon="building"
                  title="No Accounts found."
                  variant="panel"
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {accountWorkspaces.map((workspace) => (
                    <WorkspaceListItem
                      density="panel"
                      key={workspace.id}
                      onRunAction={runAction}
                      pendingKey={pendingKey}
                      workspace={workspace}
                    />
                  ))}
                </div>
              )}
            </WorkspaceGroup>
          ) : null}

          {pendingMatches ? (
            <WorkspaceGroup icon="inbox" title="Pending" variant="panel">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">
                    {notificationSummary.total} pending
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {notificationSummary.items
                      .map((item) => `${item.count} ${item.label}`)
                      .join(pendingSeparator)}
                  </p>
                </div>
                <Link
                  className={hubButtonClass("primary", "panel")}
                  href={notificationSummary.reviewHref}
                  onClick={closeAndFocus}
                >
                  <span className="truncate">Review</span>
                </Link>
              </div>
            </WorkspaceGroup>
          ) : null}

          {isFiltering && !hasDirectoryResults ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-4 text-sm text-zinc-500">
              <p className="font-semibold text-zinc-800">
                {`No salons or workspaces match "${query.trim()}".`}
              </p>
              <button
                className="mt-3 inline-flex min-h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                type="button"
              >
                Clear search
              </button>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-zinc-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Link
            className={hubButtonClass("secondary", "panel") + " w-full"}
            href="/my-place"
            onClick={closeAndFocus}
          >
            <HubIcon className="h-4 w-4 shrink-0" name="grid" />
            <span className="truncate">View full My Place</span>
          </Link>
        </div>
      </aside>
      <ActionDialog
        description={error ?? ""}
        onClose={() => setError(null)}
        open={Boolean(error)}
        primaryAction={{
          label: "Review workspaces",
          onClick: () => setError(null),
        }}
        secondaryAction={{ href: "/explore", label: "Explore" }}
        title="Workspace action needed"
      />
    </div>
  );
}

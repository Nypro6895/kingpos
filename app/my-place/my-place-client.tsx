"use client";

import { switchWorkspaceDestination } from "@/app/salons/actions";
import {
  HubIcon,
  QuickAccessItem,
  SearchField,
  WorkspaceActionButton,
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
import { useRef, useState, useTransition } from "react";

type MyPlaceClientProps = {
  currentWorkspace: CurrentWorkspaceOption | null;
  error?: string;
  pendingSummary: WorkspacePendingSummary;
  workspaceOptions: CurrentWorkspaceOption[];
};

function findOwnerOrganizationWorkspace(input: {
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const organizations = input.workspaceOptions.filter(
    (workspace) =>
      workspace.type === "organization" &&
      workspace.menuActions.some((action) => action.href === "/salons"),
  );

  return (
    organizations.find(
      (workspace) =>
        workspace.organizationId === input.currentWorkspace?.organizationId,
    ) ??
    organizations[0] ??
    null
  );
}

export function MyPlaceClient({
  currentWorkspace,
  error,
  pendingSummary,
  workspaceOptions,
}: MyPlaceClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState(error ?? null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
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
  const organizationWorkspaces = workspaceOptions.filter(
    (workspace) => workspace.type === "organization" && matchesWorkspace(workspace),
  );
  const quickAccess = buildWorkspaceShortcuts({
    currentWorkspace,
    limit: 6,
    query: normalizedQuery,
    workspaceOptions,
  });
  const ownerOrganizationWorkspace = findOwnerOrganizationWorkspace({
    currentWorkspace,
    workspaceOptions,
  });
  const createSalonAction = ownerOrganizationWorkspace?.menuActions.find(
    (action) => action.href === "/salons",
  );
  const pendingMatches =
    pendingSummary.total > 0 &&
    (!normalizedQuery ||
      [
        "pending",
        "invitations",
        "applications",
        "notifications",
        ...pendingSummary.items.map((item) => item.label),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery));
  const showQuickAccess = quickAccess.length > 0;
  const showManageGroup = !isFiltering || manageWorkspaces.length > 0;
  const showStaffGroup = !isFiltering || staffWorkspaces.length > 0;
  const showOrganizationGroup = !isFiltering || organizationWorkspaces.length > 0;
  const hasResults =
    quickAccess.length > 0 ||
    manageWorkspaces.length > 0 ||
    staffWorkspaces.length > 0 ||
    organizationWorkspaces.length > 0 ||
    pendingMatches;
  const pendingSeparator = " " + String.fromCharCode(183) + " ";

  const runAction: RunWorkspaceAction = (
    workspace: CurrentWorkspaceOption,
    action: CurrentWorkspaceAction,
  ) => {
    const key = actionKey(workspace, action);

    if (pendingKey) {
      return;
    }

    setErrorMessage(null);
    setPendingKey(key);
    startTransition(async () => {
      if (workspace.id === currentWorkspaceId) {
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
        setErrorMessage(result.message);
        setPendingKey(null);
        return;
      }

      router.push(result.href);
      router.refresh();
      setPendingKey(null);
    });
  };

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-7 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold text-zinc-950">My Place</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Your salons, workplaces, and organizations.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          {ownerOrganizationWorkspace && createSalonAction ? (
            <WorkspaceActionButton
              action={{
                ...createSalonAction,
                id: "create-salon",
                label: "Create salon",
              }}
              icon="plus"
              onRunAction={runAction}
              pendingKey={pendingKey}
              variant="primary"
              workspace={ownerOrganizationWorkspace}
            />
          ) : (
            <Link className={hubButtonClass("primary")} href="/organizations">
              <HubIcon className="h-4 w-4 shrink-0" name="plus" />
              <span className="truncate">Create organization</span>
            </Link>
          )}
          <Link className={hubButtonClass("secondary")} href="/staff/connections">
            <HubIcon className="h-4 w-4 shrink-0" name="user-plus" />
            <span className="truncate">Apply to salon</span>
          </Link>
        </div>
      </div>

      {errorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </p>
      ) : null}

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
      />

      {showQuickAccess ? (
        <WorkspaceGroup
          count={quickAccess.length}
          description="Open frequently used destinations directly."
          icon="zap"
          title="Quick Access"
        >
          <div className="grid min-w-0 grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {quickAccess.map((shortcut) => (
              <QuickAccessItem
                key={shortcut.id}
                onRunAction={runAction}
                pendingKey={pendingKey}
                shortcut={shortcut}
              />
            ))}
          </div>
        </WorkspaceGroup>
      ) : null}

      <div
        className={
          isFiltering
            ? "grid min-w-0 gap-4 md:grid-cols-2"
            : "grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        }
      >
        <div className={isFiltering ? "contents" : "grid min-w-0 content-start gap-4"}>
          {showManageGroup ? (
            <WorkspaceGroup
              count={manageWorkspaces.length}
              description="Salons you own or manage."
              icon="store"
              title="Manage Salons"
            >
              {manageWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  action={
                    ownerOrganizationWorkspace && createSalonAction ? (
                      <WorkspaceActionButton
                        action={{
                          ...createSalonAction,
                          id: "create-salon-empty",
                          label: "Create salon",
                        }}
                        icon="plus"
                        onRunAction={runAction}
                        pendingKey={pendingKey}
                        variant="secondary"
                        workspace={ownerOrganizationWorkspace}
                      />
                    ) : null
                  }
                  icon="store"
                  title="No managed salons yet."
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {manageWorkspaces.map((workspace) => (
                    <WorkspaceListItem
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
        </div>

        <div className={isFiltering ? "contents" : "grid min-w-0 content-start gap-4"}>
          {showStaffGroup ? (
            <WorkspaceGroup
              count={staffWorkspaces.length}
              description="Salons where you work as staff."
              icon="briefcase"
              title="Staff Workplaces"
            >
              {staffWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  action={
                    <Link
                      className={hubButtonClass("secondary")}
                      href="/staff/connections"
                    >
                      <HubIcon className="h-4 w-4 shrink-0" name="user-plus" />
                      <span className="truncate">Apply to salon</span>
                    </Link>
                  }
                  icon="briefcase"
                  title="No staff workplaces yet."
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {staffWorkspaces.map((workspace) => (
                    <WorkspaceListItem
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

          {showOrganizationGroup ? (
            <WorkspaceGroup
              count={organizationWorkspaces.length}
              description="Organizations connected to your account."
              icon="building"
              title="Organizations"
            >
              {organizationWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  icon="building"
                  title="No connected organizations."
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {organizationWorkspaces.map((workspace) => (
                    <WorkspaceListItem
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
        </div>
      </div>

      {pendingMatches ? (
        <WorkspaceGroup
          count={pendingSummary.total}
          icon="inbox"
          title="Invitations & Applications"
        >
          <div className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950">
                {pendingSummary.total} pending
              </p>
              <p className="mt-1 truncate text-sm text-zinc-500">
                {pendingSummary.items
                  .map((item) => `${item.count} ${item.label}`)
                  .join(pendingSeparator)}
              </p>
            </div>
            <Link className={hubButtonClass("primary")} href={pendingSummary.reviewHref}>
              <span className="truncate">Review</span>
            </Link>
          </div>
        </WorkspaceGroup>
      ) : null}

      {isFiltering && !hasResults ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500">
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
    </main>
  );
}

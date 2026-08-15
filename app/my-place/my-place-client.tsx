"use client";

import { ActionDialog } from "@/app/action-dialog";
import { switchWorkspaceDestination } from "@/app/salons/actions";
import {
  HubIcon,
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
  workspaceSearchText,
} from "@/app/workspace-display";
import type {
  CurrentWorkspaceAction,
  CurrentWorkspaceOption,
} from "@/lib/current-context";
import { routes } from "@/lib/routes";
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

function findOwnerAccountWorkspace(input: {
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const accounts = input.workspaceOptions.filter(
    (workspace) =>
      workspace.type === "account" &&
      workspace.menuActions.some((action) => action.href === routes.salons.create()),
  );

  return (
    accounts.find(
      (workspace) => workspace.accountId === input.currentWorkspace?.accountId,
    ) ??
    accounts[0] ??
    null
  );
}

function workspaceErrorDialogCopy(message: string) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("salon workspace")) {
    return {
      description:
        "That page needs an active salon workspace. Choose an owner or staff workspace here, or return to Explore.",
      title: "Salon workspace required",
    };
  }

  if (lowerMessage.includes("account workspace")) {
    return {
      description:
        "That page needs an active account workspace. Choose an account workspace here, or return to Explore.",
      title: "Account workspace required",
    };
  }

  if (
    lowerMessage.includes("no longer have access") ||
    lowerMessage.includes("connected to your account")
  ) {
    return {
      description:
        "That workspace is not available to your account anymore. Review your available workspaces or return to Explore.",
      title: "Workspace unavailable",
    };
  }

  return {
    description: message,
    title: "Workspace action needed",
  };
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
  const accountWorkspaces = workspaceOptions.filter(
    (workspace) => workspace.type === "account" && matchesWorkspace(workspace),
  );
  const ownerAccountWorkspace = findOwnerAccountWorkspace({
    currentWorkspace,
    workspaceOptions,
  });
  const createSalonAction = ownerAccountWorkspace?.menuActions.find(
    (action) => action.href === routes.salons.create(),
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
  const showManageGroup = !isFiltering || manageWorkspaces.length > 0;
  const showStaffGroup = !isFiltering || staffWorkspaces.length > 0;
  const showAccountGroup = !isFiltering || accountWorkspaces.length > 0;
  const hasResults =
    manageWorkspaces.length > 0 ||
    staffWorkspaces.length > 0 ||
    accountWorkspaces.length > 0 ||
    pendingMatches;
  const pendingSeparator = " " + String.fromCharCode(183) + " ";
  const errorDialog = errorMessage
    ? workspaceErrorDialogCopy(errorMessage)
    : null;

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
      <div className="flex min-w-0 flex-wrap gap-2">
        {ownerAccountWorkspace && createSalonAction ? (
          <WorkspaceActionButton
            action={{
              ...createSalonAction,
              id: "create-salon",
              label: "Create Salon",
            }}
            icon="plus"
            onRunAction={runAction}
            pendingKey={pendingKey}
            variant="primary"
            workspace={ownerAccountWorkspace}
          />
        ) : null}
        <Link className={hubButtonClass("secondary")} href="/staff/connections">
          <HubIcon className="h-4 w-4 shrink-0" name="user-plus" />
          <span className="truncate">Apply to Salon</span>
        </Link>
      </div>

      <ActionDialog
        description={errorDialog?.description ?? ""}
        onClose={() => setErrorMessage(null)}
        open={Boolean(errorDialog)}
        primaryAction={{
          label: "Choose workspace",
          onClick: () => {
            setErrorMessage(null);
            window.setTimeout(() => searchRef.current?.focus(), 0);
          },
        }}
        secondaryAction={{ href: "/explore", label: "Explore" }}
        title={errorDialog?.title ?? "Workspace action needed"}
      />

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
              title="Owner Salons"
            >
              {manageWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  action={
                    ownerAccountWorkspace && createSalonAction ? (
                      <WorkspaceActionButton
                        action={{
                          ...createSalonAction,
                          id: "create-salon-empty",
                          label: "Create Salon",
                        }}
                        icon="plus"
                        onRunAction={runAction}
                        pendingKey={pendingKey}
                        variant="secondary"
                        workspace={ownerAccountWorkspace}
                      />
                    ) : null
                  }
                  icon="store"
                  title="No owner salons yet."
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
                      <span className="truncate">Apply to Salon</span>
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

          {showAccountGroup ? (
            <WorkspaceGroup
              count={accountWorkspaces.length}
              description="Account workspaces connected to your login."
              icon="building"
              title="Accounts"
            >
              {accountWorkspaces.length === 0 ? (
                <WorkspaceGroupEmpty
                  icon="building"
                  title="No connected Accounts."
                />
              ) : (
                <div className="divide-y divide-zinc-100">
                  {accountWorkspaces.map((workspace) => (
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

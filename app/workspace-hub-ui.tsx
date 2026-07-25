"use client";

import {
  actionKey,
  getWorkspaceOpenAction,
  initialsFor,
  splitWorkspaceActions,
  workspaceModeLabel,
  workspaceSubtitle,
  type WorkspaceShortcut,
} from "@/app/workspace-display";
import type {
  CurrentWorkspaceAction,
  CurrentWorkspaceOption,
} from "@/lib/current-context";
import { type ReactNode } from "react";

export type WorkspaceHubVariant = "page" | "panel";

export type HubIconName =
  | "building"
  | "briefcase"
  | "chevron-right"
  | "ellipsis"
  | "grid"
  | "inbox"
  | "plus"
  | "search"
  | "send"
  | "store"
  | "user-plus"
  | "workspace"
  | "x"
  | "zap";

export type RunWorkspaceAction = (
  workspace: CurrentWorkspaceOption,
  action: CurrentWorkspaceAction,
) => void;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function middleDot() {
  return " " + String.fromCharCode(183) + " ";
}

export function HubIcon({
  className = "h-4 w-4",
  name,
}: {
  className?: string;
  name: HubIconName;
}) {
  const common = {
    "aria-hidden": true,
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };
  const paths: Record<HubIconName, ReactNode> = {
    building: (
      <>
        <rect height="20" rx="2" width="16" x="4" y="2" />
        <path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
      </>
    ),
    briefcase: (
      <>
        <path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1" />
        <rect height="14" rx="2" width="18" x="3" y="6" />
        <path d="M3 12h18" />
      </>
    ),
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    ellipsis: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    grid: (
      <>
        <rect height="7" rx="1" width="7" x="3" y="3" />
        <rect height="7" rx="1" width="7" x="14" y="3" />
        <rect height="7" rx="1" width="7" x="3" y="14" />
        <rect height="7" rx="1" width="7" x="14" y="14" />
      </>
    ),
    inbox: (
      <>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="m5.5 5 13 0 3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4z" />
        <path d="M22 2 11 13" />
      </>
    ),
    store: (
      <>
        <path d="M4 10h16l-1-6H5z" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    "user-plus": (
      <>
        <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M19 8v6M16 11h6" />
      </>
    ),
    workspace: (
      <>
        <rect height="7" rx="1.5" width="18" x="3" y="3" />
        <rect height="8" rx="1.5" width="8" x="3" y="13" />
        <rect height="8" rx="1.5" width="7" x="14" y="13" />
      </>
    ),
    x: <path d="M18 6 6 18M6 6l12 12" />,
    zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

export function hubButtonClass(
  variant: "primary" | "secondary" = "secondary",
  density: WorkspaceHubVariant = "page",
) {
  return cn(
    "inline-flex max-w-full min-w-0 items-center justify-center gap-2 rounded-md text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-60",
    density === "panel" ? "min-h-9 px-2.5 py-1.5" : "min-h-10 px-3 py-2",
    variant === "primary"
      ? "bg-zinc-950 text-white hover:bg-zinc-800"
      : "border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50",
  );
}

export function WorkspaceAvatar({
  imageUrl,
  label,
  variant = "page",
}: {
  imageUrl?: string | null;
  label: string;
  variant?: WorkspaceHubVariant;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-950 font-semibold text-white",
        variant === "panel" ? "h-9 w-9 text-[11px]" : "h-10 w-10 text-xs",
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="h-full w-full object-cover" src={imageUrl} />
      ) : (
        initialsFor(label)
      )}
    </span>
  );
}

export function WorkspaceCountBadge({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
      {count}
    </span>
  );
}

function iconTileClass(variant: WorkspaceHubVariant) {
  return cn(
    "grid shrink-0 place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-700",
    variant === "panel" ? "h-8 w-8" : "h-9 w-9",
  );
}

export function WorkspaceGroup({
  children,
  count,
  description,
  icon,
  title,
  variant = "page",
}: {
  children: ReactNode;
  count?: number;
  description?: string;
  icon: HubIconName;
  title: string;
  variant?: WorkspaceHubVariant;
}) {
  const headingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${variant}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 rounded-xl border border-zinc-200 bg-white",
        variant === "panel" ? "grid gap-0" : "grid gap-0",
      )}
    >
      <div
        className={cn(
          "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-zinc-100",
          variant === "panel" ? "px-3 py-3" : "px-4 py-4",
        )}
      >
        <span className={iconTileClass(variant)}>
          <HubIcon className={variant === "panel" ? "h-4 w-4" : "h-5 w-5"} name={icon} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {variant === "panel" ? (
              <h3
                className="truncate text-sm font-semibold text-zinc-950"
                id={headingId}
              >
                {title}
              </h3>
            ) : (
              <h2
                className="truncate text-lg font-semibold text-zinc-950"
                id={headingId}
              >
                {title}
              </h2>
            )}
            {typeof count === "number" ? <WorkspaceCountBadge count={count} /> : null}
          </div>
          {description ? (
            <p
              className={cn(
                "mt-0.5 truncate text-zinc-500",
                variant === "panel" ? "text-xs" : "text-sm",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function WorkspaceGroupEmpty({
  action,
  children,
  icon,
  title,
  variant = "page",
}: {
  action?: ReactNode;
  children?: ReactNode;
  icon: HubIconName;
  title: string;
  variant?: WorkspaceHubVariant;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 text-sm text-zinc-500",
        variant === "panel" ? "px-3 py-3" : "px-4 py-4",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-zinc-50 text-zinc-500">
          <HubIcon className="h-4 w-4" name={icon} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-zinc-800">{title}</p>
          {children ? <p className="mt-0.5 text-zinc-500">{children}</p> : null}
        </div>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function SearchField({
  onClear,
  onChange,
  placeholder,
  query,
  refCallback,
  variant = "page",
}: {
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  query: string;
  refCallback?: (node: HTMLInputElement | null) => void;
  variant?: WorkspaceHubVariant;
}) {
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">{placeholder}</span>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
        <HubIcon className="h-4 w-4" name="search" />
      </span>
      <input
        className={cn(
          "w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-10 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950",
          variant === "panel" ? "h-10" : "h-11",
        )}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        ref={refCallback}
        type="search"
        value={query}
      />
      {query ? (
        <button
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          onClick={onClear}
          type="button"
        >
          <HubIcon className="h-4 w-4" name="x" />
        </button>
      ) : null}
    </label>
  );
}

export function WorkspaceActionButton({
  action,
  ariaLabel,
  icon,
  iconOnly = false,
  label,
  onRunAction,
  pendingKey,
  variant = "secondary",
  density = "page",
  workspace,
}: {
  action: CurrentWorkspaceAction;
  ariaLabel?: string;
  density?: WorkspaceHubVariant;
  icon?: HubIconName;
  iconOnly?: boolean;
  label?: string;
  onRunAction: RunWorkspaceAction;
  pendingKey: string | null;
  variant?: "menu" | "primary" | "secondary";
  workspace: CurrentWorkspaceOption;
}) {
  const key = actionKey(workspace, action);
  const isPending = pendingKey === key;

  if (variant === "menu") {
    return (
      <button
        aria-busy={isPending ? "true" : undefined}
        className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-60"
        disabled={Boolean(pendingKey)}
        onClick={() => onRunAction(workspace, action)}
        type="button"
      >
        {icon ? <HubIcon className="h-4 w-4 shrink-0" name={icon} /> : null}
        <span className="truncate">{isPending ? "Opening..." : (label ?? action.label)}</span>
      </button>
    );
  }

  if (iconOnly) {
    return (
      <button
        aria-busy={isPending ? "true" : undefined}
        aria-label={ariaLabel ?? action.label}
        className={cn(
          "grid shrink-0 place-items-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-60",
          density === "panel" ? "h-9 w-9" : "h-10 w-10",
          variant === "primary"
            ? "bg-zinc-950 text-white hover:bg-zinc-800"
            : "border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50",
        )}
        disabled={Boolean(pendingKey)}
        onClick={() => onRunAction(workspace, action)}
        type="button"
      >
        <HubIcon className="h-4 w-4" name={icon ?? "chevron-right"} />
      </button>
    );
  }

  return (
    <button
      aria-busy={isPending ? "true" : undefined}
      className={hubButtonClass(variant, density)}
      disabled={Boolean(pendingKey)}
      onClick={() => onRunAction(workspace, action)}
      type="button"
    >
      {icon ? <HubIcon className="h-4 w-4 shrink-0" name={icon} /> : null}
      <span className="truncate">{isPending ? "Opening..." : (label ?? action.label)}</span>
    </button>
  );
}

function actionIdentity(action: CurrentWorkspaceAction) {
  return `${action.id}:${action.href}`;
}

function workspaceRowMenuActions(workspace: CurrentWorkspaceOption) {
  const primaryKey = workspace.primaryAction
    ? actionIdentity(workspace.primaryAction)
    : null;
  const seen = new Set<string>();
  const actions: CurrentWorkspaceAction[] = [];

  for (const action of [...workspace.quickActions, ...workspace.menuActions]) {
    const key = actionIdentity(action);

    if (key === primaryKey || seen.has(key)) {
      continue;
    }

    seen.add(key);
    actions.push(action);
  }

  return actions;
}

export function WorkspaceActionMenu({
  actions,
  density = "page",
  label,
  onRunAction,
  pendingKey,
  workspace,
}: {
  actions: CurrentWorkspaceAction[];
  density?: WorkspaceHubVariant;
  label?: string;
  onRunAction: RunWorkspaceAction;
  pendingKey: string | null;
  workspace: CurrentWorkspaceOption;
}) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <details className="relative shrink-0">
      <summary
        aria-label={label ? undefined : `More actions for ${workspace.label}`}
        aria-disabled={pendingKey ? "true" : undefined}
        className={cn(
          "inline-flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
          density === "panel" ? "min-h-9 px-2.5" : "min-h-10 px-3",
          label ? "" : density === "panel" ? "w-9 px-0" : "w-10 px-0",
          pendingKey ? "pointer-events-none opacity-60" : "",
        )}
        onClick={(event) => {
          if (pendingKey) {
            event.preventDefault();
          }
        }}
      >
        {label ? <span>{label}</span> : null}
        <HubIcon className="h-4 w-4" name="ellipsis" />
      </summary>
      <div className="absolute right-0 z-40 mt-2 grid max-h-[min(22rem,60vh)] min-w-48 max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl">
        {actions.map((action) => (
          <WorkspaceActionButton
            action={action}
            density={density}
            key={`${workspace.id}-${action.id}-${action.href}`}
            onRunAction={onRunAction}
            pendingKey={pendingKey}
            variant="menu"
            workspace={workspace}
          />
        ))}
      </div>
    </details>
  );
}

export function WorkspaceListItem({
  density = "page",
  onRunAction,
  pendingKey,
  workspace,
}: {
  density?: WorkspaceHubVariant;
  onRunAction: RunWorkspaceAction;
  pendingKey: string | null;
  workspace: CurrentWorkspaceOption;
}) {
  const openAction = getWorkspaceOpenAction(workspace);
  const primaryAction = workspace.primaryAction;
  const menuActions = workspaceRowMenuActions(workspace);
  const subtitle = workspaceSubtitle(workspace);
  const isAccount = workspace.type === "account";

  return (
    <article
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center border-t border-zinc-100 first:border-t-0",
        density === "panel" ? "gap-2 px-3 py-2.5" : "gap-3 px-4 py-3.5",
      )}
    >
      <button
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md text-left transition hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-60"
        disabled={Boolean(pendingKey)}
        onClick={() => onRunAction(workspace, openAction)}
        type="button"
      >
        <WorkspaceAvatar
          imageUrl={workspace.avatarUrl}
          label={workspace.label}
          variant={density}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {workspace.label}
          </span>
          {subtitle ? (
            <span
              className={cn(
                "mt-0.5 block truncate text-zinc-500",
                density === "panel" ? "text-xs" : "text-sm",
              )}
            >
              {subtitle}
            </span>
          ) : null}
        </span>
      </button>
      <div className="flex max-w-full shrink-0 items-center gap-1.5">
        {primaryAction ? (
          <WorkspaceActionButton
            action={primaryAction}
            ariaLabel={`Open ${workspace.label}`}
            density={density}
            icon={isAccount ? "chevron-right" : undefined}
            iconOnly={isAccount}
            onRunAction={onRunAction}
            pendingKey={pendingKey}
            variant={isAccount ? "secondary" : "primary"}
            workspace={workspace}
          />
        ) : null}
        <WorkspaceActionMenu
          actions={menuActions}
          density={density}
          onRunAction={onRunAction}
          pendingKey={pendingKey}
          workspace={workspace}
        />
      </div>
    </article>
  );
}

export function QuickAccessItem({
  density = "page",
  onRunAction,
  pendingKey,
  shortcut,
}: {
  density?: WorkspaceHubVariant;
  onRunAction: RunWorkspaceAction;
  pendingKey: string | null;
  shortcut: WorkspaceShortcut;
}) {
  const key = actionKey(shortcut.workspace, shortcut.action);
  const isPending = pendingKey === key;
  const destination = `${shortcut.action.label}${middleDot()}${workspaceModeLabel(shortcut.workspace)}`;

  return (
    <button
      aria-busy={isPending ? "true" : undefined}
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-lg border border-zinc-200 bg-white text-left transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-60",
        density === "panel"
          ? "min-h-[64px] gap-2 px-2.5 py-2"
          : "min-h-[78px] gap-3 px-3 py-3",
      )}
      disabled={Boolean(pendingKey)}
      onClick={() => onRunAction(shortcut.workspace, shortcut.action)}
      type="button"
    >
      <WorkspaceAvatar
        imageUrl={shortcut.workspace.avatarUrl}
        label={shortcut.workspace.label}
        variant={density}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-zinc-950">
          {shortcut.workspace.label}
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-zinc-500",
            density === "panel" ? "text-xs" : "text-sm",
          )}
        >
          {isPending ? "Opening..." : destination}
        </span>
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400">
        <HubIcon className="h-4 w-4" name="chevron-right" />
      </span>
    </button>
  );
}

export function CurrentWorkspaceCard({
  currentWorkspace,
  onRunAction,
  pendingKey,
}: {
  currentWorkspace: CurrentWorkspaceOption;
  onRunAction: RunWorkspaceAction;
  pendingKey: string | null;
}) {
  const actionGroups = splitWorkspaceActions(currentWorkspace, 3);
  const badge = currentWorkspace.salonMode
    ? workspaceModeLabel(currentWorkspace)
    : null;
  const subtitle = workspaceSubtitle(currentWorkspace);

  return (
    <section
      aria-labelledby="current-workspace-title"
      className="grid min-w-0 gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3"
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <span className={iconTileClass("panel")}>
          <HubIcon className="h-4 w-4" name="workspace" />
        </span>
        <h3
          className="truncate text-sm font-semibold text-zinc-950"
          id="current-workspace-title"
        >
          Current Workspace
        </h3>
      </div>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <WorkspaceAvatar
          imageUrl={currentWorkspace.avatarUrl}
          label={currentWorkspace.label}
          variant="panel"
        />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-950">
            <span className="truncate">{currentWorkspace.label}</span>
            {badge ? (
              <span className="shrink-0 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-zinc-600">
                {badge}
              </span>
            ) : null}
          </p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actionGroups.direct.length > 0 || actionGroups.more.length > 0 ? (
        <div className="grid min-w-0 grid-cols-2 gap-1.5 min-[420px]:flex min-[420px]:flex-nowrap">
          {actionGroups.direct.map((action) => (
            <WorkspaceActionButton
              action={action}
              density="panel"
              key={`${currentWorkspace.id}-${action.id}-${action.href}`}
              onRunAction={onRunAction}
              pendingKey={pendingKey}
              variant="secondary"
              workspace={currentWorkspace}
            />
          ))}
          <WorkspaceActionMenu
            actions={actionGroups.more}
            density="panel"
            label="More"
            onRunAction={onRunAction}
            pendingKey={pendingKey}
            workspace={currentWorkspace}
          />
        </div>
      ) : null}
    </section>
  );
}

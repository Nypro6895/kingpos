import type {
  CurrentWorkspaceAction,
  CurrentWorkspaceOption,
} from "@/lib/current-context";

export type WorkspaceShortcut = {
  action: CurrentWorkspaceAction;
  id: string;
  workspace: CurrentWorkspaceOption;
};

export function initialsFor(label: string) {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "K";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function workspaceModeLabel(workspace: CurrentWorkspaceOption) {
  if (workspace.salonMode === "manage") {
    return "Manage";
  }

  if (workspace.salonMode === "staff") {
    return "Staff";
  }

  return workspace.type === "organization" ? "Organization" : "Personal";
}

function uniqueDisplayParts(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return parts.filter((part): part is string => {
    const cleaned = part?.trim();

    if (!cleaned) {
      return false;
    }

    const key = cleaned.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function workspaceSubtitleParts(workspace: CurrentWorkspaceOption) {
  if (workspace.type === "organization") {
    return uniqueDisplayParts([
      workspace.roleLabel,
      workspace.salonCount !== null
        ? `${workspace.salonCount} ${workspace.salonCount === 1 ? "salon" : "salons"}`
        : null,
    ]);
  }

  if (workspace.type === "salon") {
    return uniqueDisplayParts([workspace.roleLabel, workspace.organizationName]);
  }

  return uniqueDisplayParts([workspace.roleLabel]);
}

export function workspaceSubtitle(workspace: CurrentWorkspaceOption) {
  return workspaceSubtitleParts(workspace).join(" " + String.fromCharCode(183) + " ");
}

export function workspaceSearchText(workspace: CurrentWorkspaceOption) {
  return [
    workspace.label,
    workspace.description,
    workspace.organizationName,
    workspace.roleLabel,
    workspace.salonName,
    workspaceModeLabel(workspace),
    ...workspace.quickActions.map((action) => action.label),
    ...workspace.menuActions.map((action) => action.label),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function actionKey(
  workspace: CurrentWorkspaceOption,
  action: CurrentWorkspaceAction,
) {
  return `${workspace.id}:${action.id}:${action.href}`;
}

export function getWorkspaceOpenAction(workspace: CurrentWorkspaceOption) {
  return (
    workspace.secondaryAction ??
    workspace.primaryAction ?? {
      href: workspace.defaultHref,
      id: "open",
      label:
        workspace.type === "organization" ? "Open organization" : "Open workspace",
    }
  );
}

export function splitWorkspaceActions(
  workspace: CurrentWorkspaceOption,
  directLimit = 3,
) {
  const direct = workspace.quickActions.slice(0, directLimit);
  const directKeys = new Set(direct.map((action) => `${action.id}:${action.href}`));
  const seenMoreKeys = new Set<string>();
  const more: CurrentWorkspaceAction[] = [];

  for (const action of [
    ...workspace.quickActions.slice(directLimit),
    ...workspace.menuActions,
  ]) {
    const key = `${action.id}:${action.href}`;

    if (directKeys.has(key) || seenMoreKeys.has(key)) {
      continue;
    }

    seenMoreKeys.add(key);
    more.push(action);
  }

  return { direct, more };
}

export function buildWorkspaceShortcuts(input: {
  currentWorkspace: CurrentWorkspaceOption | null;
  limit: number;
  query: string;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const shortcuts: WorkspaceShortcut[] = [];
  const seen = new Set<string>();

  function addShortcut(
    workspace: CurrentWorkspaceOption,
    action: CurrentWorkspaceAction | null,
  ) {
    if (!action || workspace.type === "personal") {
      return;
    }

    if (workspace.id === input.currentWorkspace?.id) {
      return;
    }

    const id = actionKey(workspace, action);
    const searchText = [
      workspace.label,
      workspace.organizationName,
      workspace.roleLabel,
      workspaceModeLabel(workspace),
      action.label,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (seen.has(id) || (input.query && !searchText.includes(input.query))) {
      return;
    }

    seen.add(id);
    shortcuts.push({ action, id, workspace });
  }

  for (const workspace of input.workspaceOptions) {
    addShortcut(workspace, workspace.primaryAction);
  }

  return shortcuts.slice(0, input.limit);
}

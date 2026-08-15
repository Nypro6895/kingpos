import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function routePrefixesFor(source, kind) {
  const match = source.match(
    new RegExp(`${kind}: \\{[\\s\\S]*?routePrefixes: \\[([\\s\\S]*?)\\]`),
  );

  assert.ok(match, `Missing ${kind} routePrefixes block.`);

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function sharedContextPrefixesFor(source) {
  const match = source.match(
    /SHARED_CONTEXT_ROUTE_PREFIXES = \[([\s\S]*?)\] as const/,
  );

  assert.ok(match, "Missing shared context route prefixes.");

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("shared destinations preserve the selected workspace role", () => {
  const navigationShell = read("app/navigation-shell.tsx");
  const roleNavigation = read("app/role-navigation.ts");
  const sharedPrefixes = sharedContextPrefixesFor(roleNavigation);
  const personalPrefixes = routePrefixesFor(roleNavigation, "personal");
  const ownerPrefixes = routePrefixesFor(roleNavigation, "owner");
  const staffPrefixes = routePrefixesFor(roleNavigation, "staff");

  for (const route of [
    "/account",
    "/settings",
    "/explore",
    "/notifications",
    "/more",
    "/my-place",
  ]) {
    assert.ok(
      sharedPrefixes.includes(route),
      `${route} must preserve the selected workspace context.`,
    );
    assert.ok(
      !personalPrefixes.includes(route),
      `${route} must not force the personal route context.`,
    );
  }

  for (const route of ["/more", "/notifications", "/explore"]) {
    assert.ok(
      !ownerPrefixes.includes(route),
      `${route} must not be claimed by owner navigation.`,
    );
    assert.ok(
      !staffPrefixes.includes(route),
      `${route} must not be claimed by staff navigation.`,
    );
  }

  assert.match(
    navigationShell,
    /if \(pathname === "\/" \|\| isSharedContextRoute\(pathname\)\) \{\s*return "shared";\s*\}/,
    "Shared destinations must be classified before personal route prefixes.",
  );
  assert.match(
    navigationShell,
    /input\.routeWorkspaceKind === "shared"[\s\S]*roleNavigationKindForContext/,
    "Shared destinations must derive navigation kind from active workspace context.",
  );
  assert.match(
    navigationShell,
    /routeNavigation\?\.kind === "personal"/,
    "Personal shell selection should follow resolved navigation kind, not pathname alone.",
  );
});

test("explicit workspace switches land on canonical workspace homes", () => {
  const currentContext = read("lib/current-context.ts");
  const navigationShell = read("app/navigation-shell.tsx");
  const salonActions = read("app/salons/actions.ts");

  assert.match(
    currentContext,
    /export function getWorkspaceLandingHref\(workspace: CurrentWorkspaceOption\) \{[\s\S]*workspace\.type === "personal"[\s\S]*return "\/explore";[\s\S]*return workspace\.defaultHref;/,
    "Current context must expose one canonical landing helper.",
  );
  assert.match(
    currentContext,
    /defaultRouteForCurrentContext: getWorkspaceLandingHref\(currentWorkspace\)/,
    "Resolved context defaults must go through the canonical landing helper.",
  );
  assert.match(
    salonActions,
    /const href = destinationHref \|\| getWorkspaceLandingHref\(workspace\)/,
    "Destination switch fallback must land on the canonical workspace home.",
  );
  assert.match(
    salonActions,
    /export async function switchWorkspaceLanding[\s\S]*destinationHref: ""/,
    "Pure workspace switches must have a destination-free landing action.",
  );
  assert.equal(
    (salonActions.match(/redirect\(getWorkspaceLandingHref\(workspace\)\)/g) ??
      []).length,
    3,
    "Form-based workspace, owner-salon, and staff-salon switchers must redirect through the landing helper.",
  );
  assert.match(
    navigationShell,
    /switchWorkspaceLanding/,
    "Account switcher rows must use the landing switch action.",
  );
  assert.match(
    navigationShell,
    /onRunAction=\{runWorkspaceSwitch\}/,
    "Mobile workspace rows must call the landing switch path.",
  );
  assert.match(
    navigationShell,
    /onClick=\{\(\) => runWorkspaceSwitch\(workspace, action\)\}/,
    "Desktop workspace rows must call the landing switch path.",
  );
  assert.match(
    navigationShell,
    /runAction\(createSalonTarget\.workspace, createSalonTarget\.action\)/,
    "Explicit shortcut actions should still keep their requested destination.",
  );
});

test("workspace blocking errors render as accessible action dialogs", () => {
  const actionDialog = read("app/action-dialog.tsx");
  const myPlaceClient = read("app/my-place/my-place-client.tsx");
  const navigationShell = read("app/navigation-shell.tsx");
  const queryErrorDialog = read("app/query-error-dialog.tsx");
  const quickWorkspacePanel = read("app/quick-workspace-panel.tsx");
  const salonManagementPage = read("app/salons/salon-management-page.tsx");

  assert.match(actionDialog, /role="dialog"/);
  assert.match(actionDialog, /aria-modal="true"/);
  assert.match(actionDialog, /FOCUSABLE_SELECTOR/);
  assert.match(actionDialog, /event\.stopImmediatePropagation\(\)/);
  assert.match(queryErrorDialog, /<ActionDialog/);
  assert.match(myPlaceClient, /workspaceErrorDialogCopy/);
  assert.match(myPlaceClient, /Salon workspace required/);
  assert.match(salonManagementPage, /<QueryErrorDialog/);

  for (const [path, source] of [
    ["app/my-place/my-place-client.tsx", myPlaceClient],
    ["app/navigation-shell.tsx", navigationShell],
    ["app/quick-workspace-panel.tsx", quickWorkspacePanel],
    ["app/salons/salon-management-page.tsx", salonManagementPage],
  ]) {
    assert.doesNotMatch(
      source,
      /border-red-200 bg-red-50/,
      `${path} must not render blocking workspace errors as inline red banners.`,
    );
  }

  for (const [path, source] of [
    ["app/my-place/my-place-client.tsx", myPlaceClient],
    ["app/navigation-shell.tsx", navigationShell],
    ["app/quick-workspace-panel.tsx", quickWorkspacePanel],
  ]) {
    assert.match(source, /import \{ ActionDialog \}/, `${path} must use ActionDialog.`);
    assert.match(source, /<ActionDialog/, `${path} must render ActionDialog.`);
  }
});

test("personal account routes are still classified before broader workspace routes", () => {
  const navigationShell = read("app/navigation-shell.tsx");
  const roleNavigation = read("app/role-navigation.ts");
  const personalPrefixes = routePrefixesFor(roleNavigation, "personal");
  const ownerPrefixes = routePrefixesFor(roleNavigation, "owner");
  const staffPrefixes = routePrefixesFor(roleNavigation, "staff");

  for (const route of [
    "/activity",
    "/beauty",
    "/claim",
    "/businesses",
    "/my-bookings",
    "/salons",
    "/roles",
    "/permissions",
    "/staff/connections",
  ]) {
    assert.ok(
      personalPrefixes.includes(route),
      `${route} must stay in the personal route context.`,
    );
  }

  const personalClassification = navigationShell.indexOf(
    "ROLE_NAVIGATION.personal.routePrefixes",
  );
  const ownerClassification = navigationShell.indexOf(
    "ROLE_NAVIGATION.owner.routePrefixes",
  );

  assert.ok(personalClassification !== -1, "Shell must read personal prefixes.");
  assert.ok(ownerClassification !== -1, "Shell must read owner prefixes.");
  assert.ok(
    personalClassification < ownerClassification,
    "Personal routes must win before broader owner prefixes like /staff.",
  );

  assert.ok(!ownerPrefixes.includes("/staff/connections"));
  assert.ok(!staffPrefixes.includes("/staff/connections"));
});

test("shared routes use the selected workspace shell and More content", () => {
  const navigationShell = read("app/navigation-shell.tsx");
  const morePage = read("app/more/page.tsx");

  assert.ok(
    !navigationShell.includes("roleAwareRouteWorkspaceKind"),
    "Shell selection must not let the selected workspace role override route context.",
  );
  assert.ok(
    !navigationShell.includes("[PERSONAL_NAVIGATION_SECTION, ...workspaceSections]"),
    "Personal navigation must not be prepended to owner/account workspace sections.",
  );
  assert.ok(
    navigationShell.includes("isSharedContextWorkspaceRoute"),
    "Shared routes should keep workspace context sidebars for owner and staff workspaces.",
  );
  assert.ok(
    morePage.includes("roleNavigationKindForContext"),
    "/more must choose role content from the canonical navigation context helper.",
  );
  assert.ok(
    morePage.includes("ROLE_MORE_ITEMS.owner") &&
      morePage.includes("ROLE_MORE_ITEMS.staff") &&
      morePage.includes("ROLE_MORE_ITEMS.personal"),
    "/more must have menu content for all role shells.",
  );
  assert.ok(
    navigationShell.includes('href="/explore"') &&
      !navigationShell.includes('aria-label="Reylumi My Place"'),
    "Reylumi shell logos should open Explore without acting as a workspace switch.",
  );
});

test("More menus expose My Place and My Place omits quick access", () => {
  const myPlaceClient = read("app/my-place/my-place-client.tsx");
  const morePage = read("app/more/page.tsx");
  const roleNavigation = read("app/role-navigation.ts");

  for (const [id, role] of [
    ["personal-my-place", "personal"],
    ["owner-my-place", "owner"],
    ["staff-my-place", "staff"],
  ]) {
    const roleBlock = roleNavigation.match(
      new RegExp(`  ${role}: \\[([\\s\\S]*?)\\n  \\],`),
    );

    assert.ok(roleBlock, `Missing ${role} More menu block.`);
    assert.ok(
      roleBlock[1].includes(`id: "${id}"`) &&
        roleBlock[1].includes('href: "/my-place"') &&
        roleBlock[1].includes('navigationIcon: "grid"'),
      `${role} More menu must include a My Place link.`,
    );
  }

  for (const title of [
    "Workspace",
    "Beauty & history",
    "Account",
    "Front desk",
    "Business",
    "Work",
    "Saved & following",
  ]) {
    assert.ok(
      morePage.includes(`title: "${title}"`),
      `/more must keep role options grouped under ${title}.`,
    );
  }

  assert.match(
    morePage,
    /roleMoreItems\(roleKind\)/,
    "/more must render grouped content for the selected role shell.",
  );
  assert.match(
    morePage,
    /formatItemCount\(section\.items\.length\)/,
    "/more group counts should use singular/plural item copy.",
  );
  assert.doesNotMatch(
    myPlaceClient,
    /QuickAccessItem|buildWorkspaceShortcuts|showQuickAccess|quickAccess|Quick Access/,
    "My Place must not render the Quick Access section.",
  );
});

test("main app surfaces omit compacted page chrome titles", () => {
  for (const [path, removedCopy, removedPatterns = []] of [
    [
      "app/my-place/my-place-client.tsx",
      ["My Place", "Your salons, workplaces, and account spaces."],
    ],
    [
      "app/activity/page.tsx",
      [
        "Salon visits, purchases, and appointments connected to your ReyLUMI",
      ],
      [/<h1[^>]*>\s*Activity\s*<\/h1>/],
    ],
    [
      "app/more/page.tsx",
      ["Saved posts, favorite profiles, memberships, and account support."],
      [/<h1[^>]*>\s*\{more\.title\}\s*<\/h1>/],
    ],
    [
      "app/customers/page.tsx",
      ["Manage your salon customers."],
      [/<h1[^>]*>\s*Customers\s*<\/h1>/],
    ],
    [
      "app/staff/page.tsx",
      ["Manage staff profiles, account connection, booking setup, and POS access."],
    ],
    [
      "app/payroll/page.tsx",
      [],
      [/<h1[^>]*>\s*Payroll V1\s*<\/h1>/],
    ],
    [
      "app/pos-tickets/page.tsx",
      ["Daily POS Work Log", "Staff income history, customer visit history"],
    ],
  ]) {
    const source = read(path);

    for (const copy of removedCopy) {
      assert.ok(
        !source.includes(copy),
        `${path} must not render compacted page chrome copy: ${copy}`,
      );
    }

    for (const pattern of removedPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path} must not render compacted page chrome title pattern: ${pattern}`,
      );
    }
  }
});

test("salon profile transformation queue keeps salon route semantics", () => {
  const navigationShell = read("app/navigation-shell.tsx");
  const roleNavigation = read("app/role-navigation.ts");
  const reviewPage = read("app/salon-profile/client-transformations/page.tsx");
  const personalPrefixes = routePrefixesFor(roleNavigation, "personal");
  const ownerPrefixes = routePrefixesFor(roleNavigation, "owner");

  assert.ok(
    navigationShell.includes('if (matchesPath(pathname, "/salon-profile"))'),
    "Salon profile routes should use route context that follows the selected salon workspace.",
  );
  assert.ok(
    !personalPrefixes.includes("/salon-profile"),
    "/salon-profile must not be treated as a personal route.",
  );
  assert.ok(
    !ownerPrefixes.includes("/salon-profile"),
    "/salon-profile must remain the shared salon route instead of a broad owner prefix.",
  );
  assert.match(
    reviewPage,
    /requireSalonManagePageContext\("\/salon-profile\/client-transformations"\)/,
  );
  assert.match(
    reviewPage,
    /href="\/salon-profile"/,
    "Back to profile should preserve the same salon route context.",
  );
});

test("app notifications resolve Beauty salon requests through owner workspace context", () => {
  const appNotifications = read("lib/app-notifications.ts");
  const notificationActions = read("app/notifications/actions.ts");
  const notificationFeedItems = read("lib/notification-feed-items.ts");
  const notificationList = read("app/notifications/notification-list.tsx");
  const notificationTypes = read("types/notifications.ts");

  assert.match(appNotifications, /id, salon_id, recipient_kind/);
  assert.match(
    notificationFeedItems,
    /BEAUTY_SALON_PUBLICATION_REQUEST_TYPE =\s*"beauty_salon_publication_request"/,
  );
  assert.match(
    notificationFeedItems,
    /notification\.recipient_kind === "owner_manager"/,
  );
  assert.match(
    notificationFeedItems,
    /getManageWorkspaceId\(notification\.salon_id\)/,
    "Salon publication request notifications should target the manage workspace for their salon.",
  );
  assert.match(
    notificationFeedItems,
    /notification\.recipient_kind === "customer" && notification\.booking_id/,
    "Customer notifications should keep personal booking destinations.",
  );
  assert.match(notificationTypes, /workspaceId: string \| null/);
  assert.match(notificationList, /name="workspace_id"/);
  assert.match(notificationActions, /getCurrentAppNotification/);
  assert.match(notificationActions, /resolveAppNotificationDestination/);
  assert.match(notificationActions, /setNormalizedWorkspaceContext/);
  assert.doesNotMatch(
    notificationActions,
    /readString\(formData,\s*"workspace_id"\)/,
    "Notification opener must derive workspace context from the server notification row, not hidden form data.",
  );
  assert.match(
    notificationActions,
    /option\.id === input\.workspaceId[\s\S]*option\.type === "salon"[\s\S]*option\.salonMode === "manage"/,
    "Notification opener must validate the workspace before setting salon context.",
  );
});

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

test("personal account routes are classified before owner and staff workspace routes", () => {
  const navigationShell = read("app/navigation-shell.tsx");
  const roleNavigation = read("app/role-navigation.ts");
  const personalPrefixes = routePrefixesFor(roleNavigation, "personal");
  const ownerPrefixes = routePrefixesFor(roleNavigation, "owner");
  const staffPrefixes = routePrefixesFor(roleNavigation, "staff");

  for (const route of [
    "/account",
    "/activity",
    "/settings",
    "/notifications",
    "/more",
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

  for (const route of ["/more", "/notifications"]) {
    assert.ok(
      !ownerPrefixes.includes(route),
      `${route} must not be claimed by owner navigation.`,
    );
    assert.ok(
      !staffPrefixes.includes(route),
      `${route} must not be claimed by staff navigation.`,
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
});

test("personal routes use the canonical customer shell instead of the legacy workspace sidebar", () => {
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
    navigationShell.includes('const desktopShellBreakpoint = routeUsesPersonalShell ? "lg" : "xl";'),
    "Personal routes should switch to the canonical customer desktop shell at lg.",
  );
  assert.ok(
    navigationShell.includes('workspace.type === "personal"'),
    "Personal routes should display the personal account workspace card.",
  );
  assert.ok(
    !morePage.includes("isSalonManageContext") &&
      !morePage.includes("isSalonStaffContext"),
    "/more must not choose owner/staff menu content from the selected workspace.",
  );
});

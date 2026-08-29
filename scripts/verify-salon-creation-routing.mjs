import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const navigationShell = read("app/navigation-shell.tsx");
const salonActions = read("app/salons/actions.ts");
const salonsPage = read("app/salons/salon-management-page.tsx");
const salonsNewRoute = read("app/salons/new/page.tsx");
const businessesRoute = read("app/businesses/page.tsx");
const businessesNewRoute = read("app/businesses/new/page.tsx");
const businessesCreateRoute = read("app/businesses/create/page.tsx");
const currentContext = read("lib/current-context.ts");
const baselineMigration = read(
  "supabase/migrations/202607240001_account_salon_baseline.sql",
);

assert(
  navigationShell.includes("Create Salon"),
  "Account switcher must render Create Salon.",
);
assert(
  !navigationShell.includes("Create Business"),
  "Account switcher must not render Create Business.",
);
assert(
  navigationShell.includes("routes.salons.create()"),
  "Account switcher must use the canonical Salon create route helper.",
);
assert(
  salonsNewRoute.includes('mode="create"'),
  "/salons/new must render the Salon creation page.",
);
assert(
  salonsPage.includes("Create Salon") &&
    salonsPage.includes("Salon name") &&
    read("app/salons/create-salon-submit-button.tsx").includes("Creating salon...") &&
    !salonsPage.includes("Salon creation is paused"),
  "Salon creation page must render Salon-facing copy and the live creation form.",
);
assert(
  businessesRoute.includes("routes.salons.list()"),
  "/businesses must redirect to /salons through the route helper.",
);
assert(
  businessesNewRoute.includes("routes.salons.create()") &&
    businessesCreateRoute.includes("routes.salons.create()"),
  "Legacy Business create routes must redirect to /salons/new.",
);
assert(
  currentContext.includes('"Create Salon", routes.salons.create()') &&
    currentContext.includes('WorkspaceType = "account" | "personal" | "salon"'),
  "Workspace context must expose a single Create Salon destination.",
);
assert(
  salonActions.includes('.rpc("create_account_salon"') &&
    salonActions.includes("p_account_id: accountId") &&
    salonActions.includes("p_create_request_key: createRequestKey") &&
    salonActions.includes("getCreateSalonAccount(context)") &&
    salonsPage.includes("getCreateSalonAccount(context)") &&
    salonsPage.includes('name="create_request_key"') &&
    !salonActions.includes(".select(LOCATION_SELECT)") &&
    !salonActions.includes('.from("salon_memberships")'),
  "Create Salon action must call the atomic Account-to-Salon RPC with an idempotency key.",
);
assert(
  baselineMigration.includes("create or replace function public.create_account_salon") &&
    baselineMigration.includes(
      "create or replace function public.ensure_personal_account_for_current_user",
    ) &&
    baselineMigration.includes("insert into public.salon_memberships") &&
    baselineMigration.includes("insert into public.salon_settings") &&
    baselineMigration.includes("insert into public.booking_settings") &&
    baselineMigration.includes("insert into public.salon_payroll_settings") &&
    baselineMigration.includes("locations_account_create_request_key_idx"),
  "Baseline must atomically create salons, owner salon memberships, required salon records, and retry protection.",
);

const forbiddenCreateCopy = [
  "Create Business",
  "create business",
  "New Business",
  "Add Business",
  "Create a Business",
  "Create your first Business",
  "Business created",
  "Business name",
];

for (const path of [
  "app/navigation-shell.tsx",
  "app/my-place/my-place-client.tsx",
  "app/quick-workspace-panel.tsx",
  "app/salons/salon-management-page.tsx",
  "app/explore/page.tsx",
]) {
  const contents = read(path);

  for (const phrase of forbiddenCreateCopy) {
    assert(
      !contents.includes(phrase),
      `${path} still contains user-facing create Business copy: ${phrase}`,
    );
  }
}

console.log("Salon creation routing and copy verification passed.");

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const a = "00000000-0000-4000-8000-000000000010",
  b = "00000000-0000-4000-8000-000000000011";

test("owner activation destination keeps authentication, salon and entitlement gates", async () => {
  const stubs = {
 "@/components/owned-salon-page":"export const withOwnedSalonPage=(...args)=>args.find(a=>typeof a==='function');",
 "@/components/salon-member-badge":"export const SalonName=()=>null;",
 "@/components/submit-button":"export const SubmitButton=()=>null;",
 "@/app/market/scoped-market-actions":"export async function updateTaxSettings(){}",
    "@/app/tax/tax-renewal": "export function TaxRenewal(){return null}",
    "@/components/experience-page": "export const withExperiencePage=fn=>fn;",
    "next/link": "export default function Link(){return null}",
    "next/navigation":
      'export function redirect(path){throw Object.assign(new Error("redirect"),{path})}',
    "@/lib/current-context":
      'export async function getCurrentBusinessContext(){return globalThis.__taxSetup.context} export function isWorkspaceDestinationAllowed(w,href){return globalThis.__taxSetup.allowed&&href.startsWith("/payroll/")}',
    "@/lib/tax-company":
      "export async function taxCompanySettings(){globalThis.__taxSetup.reads++;return globalThis.__taxSetup.state}",
    "@/app/tax-company/actions": "export async function updateTaxSettings(){}",
    "@/app/tax-company/owner-credentials":
      "export function OwnerTaxCredentials(){return null}",
    "@/app/settings/plugin-settings-row":
      "export function PluginMarketStatus(){return null}",
    "@/app/tax/tax-activation-followup":
      "export function TaxActivationFollowup(){return null}",
    "@/app/tax/tax-access-link": "export function TaxAccessLink(){return null}",
    "@/app/tax-company/tax-company.module.css": "export default {}",
  };
  const out = await build({
    entryPoints: ["app/(app)/payroll/tax-company/settings/page.tsx"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    alias: { "@": process.cwd() },
    plugins: [
      {
        name: "setup-fixture",
        setup(api) {
          api.onResolve({ filter: /.*/ }, (args) =>
            stubs[args.path]
              ? { path: args.path, namespace: "stub" }
              : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: stubs[args.path],
          }));
        },
      },
    ],
  });
  const { default: Page } = await import(
    "data:text/javascript;base64," +
      Buffer.from(out.outputFiles[0].text).toString("base64")
  );
  const fixture = () => ({
    context: {
      user: { id: "owner" },
      currentSalon: { id: a },
      workspaceOptions: [],
    },
    state: {
      active: false,
      enabled: false,
      connections: [],
      salon_name: "Salon A",
    },
    allowed: true,
    reads: 0,
  });
  const nodes = (element) =>
    !element
      ? []
      : Array.isArray(element)
        ? element.flatMap(nodes)
        : typeof element === "object"
          ? [element, ...nodes(element.props?.children)]
          : [];
  try {
    let c = fixture();
    c.context.user = null;
    globalThis.__taxSetup = c;
    await assert.rejects(
      Page({ searchParams: Promise.resolve({ salon: a, setup: "1" }) }),
      (error) =>
        error.path?.startsWith("/login?") &&
        decodeURIComponent(error.path).includes(a),
    );
    assert.equal(c.reads, 0);
    c = fixture();
    c.context.workspaceOptions = [
      { id: "manage:" + b, salonId: b, salonMode: "manage" },
    ];
    globalThis.__taxSetup = c;
    await assert.rejects(
      Page({
        searchParams: Promise.resolve({ salon: b, activation: "payment" }),
      }),
      (error) =>
        error.path?.startsWith("/workspace/open?") &&
        new URLSearchParams(error.path.split("?")[1]).get("workspace_id") ===
          "manage:" + b,
    );
    assert.equal(c.reads, 0);
    c.allowed = false;
    const wrong = await Page({
      searchParams: Promise.resolve({ salon: b, setup: "1" }),
    });
    assert.equal(c.reads, 0);
    assert.ok(
      nodes(wrong).some(
        (e) => e.props?.children === "Choose the salon for this activation",
      ),
    );
    c = fixture();
    globalThis.__taxSetup = c;
    const pending = nodes(
      await Page({
        searchParams: Promise.resolve({
          salon: a,
          setup: "1",
          activation: "payment",
        }),
      }),
    );
    assert.equal(
      pending.find((e) => e.type?.name === "TaxRenewal").props
        .active,
      false,
    );
    assert.equal(
      pending.some((e) => e.type?.name === "OwnerTaxCredentials"),
      false,
    );
    c.state.active = true;
    const active = nodes(
      await Page({ searchParams: Promise.resolve({ salon: a, setup: "1" }) }),
    );
    assert.equal(
      active.find((e) => e.type?.name === "TaxActivationFollowup").props.active,
      true,
    );
    assert.equal(
      active.some((e) => e.type?.name === "OwnerTaxCredentials"),
      true,
    );
    assert.equal(
      active.some((e) => e.type?.name === "TaxAccessLink"),
      true,
    );
    assert.equal(
      active.some((e) => e.props?.href === "/tax-company"),
      false,
    );
  } finally {
    delete globalThis.__taxSetup;
  }
});

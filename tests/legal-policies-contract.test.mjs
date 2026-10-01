import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function exists(path) {
  return existsSync(join(root, path));
}

test("legal policy routes exist and use the shared static document system", () => {
  for (const path of [
    "app/(legal)/legal/page.tsx",
    "app/(legal)/terms/page.tsx",
    "app/(legal)/privacy/page.tsx",
    "app/(legal)/community/page.tsx",
    "app/(legal)/business-terms/page.tsx",
  ]) {
    assert.ok(exists(path), `${path} must exist.`);
    assert.match(read(path), /legalMetadata/, `${path} must export metadata.`);
  }

  const appLayout = read("app/(app)/layout.tsx");
  const legalLayout = read("app/(legal)/layout.tsx");
  const components = read("app/legal/legal-components.tsx");
  const tocClient = read("app/legal/legal-table-of-contents.tsx");
  assert.match(appLayout, /getCurrentBusinessContext/);
  assert.match(appLayout, /metadataBase: REYLUMI_METADATA_BASE/);
  assert.match(legalLayout, /GuestNavigationShell/);
  assert.match(legalLayout, /metadataBase: REYLUMI_METADATA_BASE/);
  assert.doesNotMatch(legalLayout, /getCurrentBusinessContext|SalonSwitcher|Supabase/i);
  assert.match(components, /LegalHub/);
  assert.match(components, /LegalDocumentPage/);
  assert.match(components, /LegalTableOfContents/);
  assert.match(tocClient, /href=\{`#\$\{section\.id\}`\}/);
  assert.match(tocClient, /aria-current=\{isActive \? "location" : undefined\}/);
  assert.match(components, /LegalRichText/);
  assert.match(components, /type LegalInline/);
  assert.doesNotMatch(components, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(tocClient, /dangerouslySetInnerHTML/);
});

test("legal hub keeps secondary policy topics as anchors", () => {
  const data = read("lib/legal-policies.ts");

  for (const href of [
    "/terms#booking",
    "/terms#payments",
    "/community#reviews",
    "/community#content",
    "/privacy#data-retention",
    "/privacy#account-deletion",
    "/business-terms#ownership-transfer",
  ]) {
    assert.ok(data.includes(`href: "${href}"`), `${href} must be an anchor link.`);
  }
  assert.ok(data.includes('id: "data-retention"'), "Data retention anchor must exist.");
  assert.ok(data.includes('label: "Data Retention"'), "Data retention must be its own link.");
  assert.ok(data.includes('label: "Account Deletion"'), "Account deletion must be its own link.");
  assert.doesNotMatch(data, /Account Deletion & Data Retention/);

  for (const forbiddenRoute of [
    "app/booking-policy/page.tsx",
    "app/reviews/page.tsx",
    "app/account-deletion/page.tsx",
    "app/ownership-transfer/page.tsx",
  ]) {
    assert.ok(!exists(forbiddenRoute), `${forbiddenRoute} must not be added.`);
  }
});

test("legal content reflects audited product scope without overclaiming", () => {
  const data = read("lib/legal-policies.ts");

  assert.match(data, /export type LegalInline/);
  assert.match(data, /type: "strong"/);
  assert.match(data, /type: "link"/);
  assert.match(data, /type: "subheading"/);
  assert.match(data, /platform that connects clients with salons/);
  assert.match(data, /may require confirmation before it is accepted/);
  assert.match(data, /Refund and cancellation outcomes depend on the applicable salon policy/);
  assert.match(data, /current POS payment records are operational records/);
  assert.match(data, /do not by themselves process or settle payment/);
  assert.match(data, /No single retention period applies to every record/);
  assert.match(data, /30-day pending deletion period/);
  assert.match(data, /sole Owner/);
  assert.match(data, /Personal Account deletion does not automatically delete lawful business/);
  assert.match(data, /Deletion of an eligible personal account may release personal identity links/);
  assert.match(data, /LUMI trust signals may be based on verified visit/);
  assert.match(data, /not a guarantee of service quality/);
  assert.match(data, /strong\("Owner authority"\)[\s\S]*server-side authorization/);
  assert.match(data, /should not become a destructive rewrite of data ownership/);
  assert.match(data, /Sensitive or historical data does not automatically transfer/);
  assert.match(data, /does not become the employer, accountant, payroll provider, tax advisor, or law firm/);
  assert.match(data, /provider disclosures and controls should match the actual implementation/);
  assert.match(data, /Legal review before launch/);
  assert.doesNotMatch(data, /the payment provider, and applicable law/);
  assert.doesNotMatch(data, /current local product architecture|product direction/);
});

test("legal documents use policy-reading UX and contextual internal links", () => {
  const data = read("lib/legal-policies.ts");
  const components = read("app/legal/legal-components.tsx");
  const tocClient = read("app/legal/legal-table-of-contents.tsx");
  const documentComponents = components.slice(
    components.indexOf("export function LegalDocumentPage"),
  );

  for (const phrase of [
    "A person may have more than one relationship with ReyLUMI",
    "Account and profile information",
    "Beauty profile and public content",
    "POS and transaction records",
    "Perform operational calculations",
    "Staff @ Salon is a salon-scoped relationship",
    "Booking data does not become public simply because a booking exists",
    "A salon ownership transfer does not automatically expose every historical or personal record",
    "User Inputs and Outputs",
    "Business continuity data may continue with the salon",
    "Do not coordinate review manipulation",
  ]) {
    assert.match(data, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const link of [
    'link("Data Retention", "/privacy#data-retention")',
    'link("Account Deletion", "/privacy#account-deletion")',
    'link("Ownership Transfer", "/business-terms#ownership-transfer")',
    'link("POS Records", "/business-terms#pos-records")',
    'link("Tax", "/business-terms#tax")',
    'link("Booking", "/terms#booking")',
  ]) {
    assert.ok(data.includes(link), `${link} must remain a contextual internal link.`);
  }

  assert.match(documentComponents, /lg:max-h-\[calc\(100vh-7rem\)\]/);
  assert.match(documentComponents, /lg:border-r/);
  assert.match(tocClient, /activeId/);
  assert.match(tocClient, /window\.addEventListener\("scroll"/);
  assert.match(components, /Effective date:/);
  assert.match(components, /Last updated:/);
  assert.doesNotMatch(documentComponents, /rounded-lg bg-white\/72 px-4 py-3 ring-1/);
  assert.doesNotMatch(documentComponents, /sm:text-5xl/);
});

test("footer and auth surfaces expose only lightweight legal links", () => {
  const config = read("lib/reylumi-config.ts");
  const footer = read("components/legal-footer.tsx");
  const guestShell = read("app/guest-navigation-shell.tsx");
  const loginPage = read("app/(app)/login/page.tsx");
  const signupForm = read("app/signup/signup-form.tsx");

  const footerBlock = config.match(/LEGAL_FOOTER_LINKS = \[([\s\S]*?)\] as const/);
  assert.ok(footerBlock, "Footer link config must exist.");

  for (const label of ["Terms", "Privacy", "Community Standards", "Legal"]) {
    assert.ok(footerBlock[1].includes(`label: "${label}"`));
  }

  assert.doesNotMatch(footerBlock[1], /Business & Salon Terms|Support|Accessibility/);
  assert.match(footer, /LEGAL_FOOTER_LINKS/);
  assert.match(guestShell, /<LegalFooter \/>/);
  assert.match(loginPage, /<LegalFooter \/>/);
  assert.doesNotMatch(loginPage, /Support|Accessibility|Terms & Conditions|ReyLumi/);

  assert.match(signupForm, /By creating an account/);
  assert.match(signupForm, /href="\/terms"/);
  assert.match(signupForm, /href="\/privacy"/);
  assert.doesNotMatch(signupForm, /Business & Salon Terms|Community Standards|Legal hub/);
});

test("settings adds legal privacy rows without client-only business role logic", () => {
  const settingsPage = read("app/(app)/settings/page.tsx");

  assert.match(settingsPage, /Legal & Privacy/);
  assert.match(settingsPage, /Terms of Service/);
  assert.match(settingsPage, /Privacy Policy/);
  assert.match(settingsPage, /Community Standards/);
  assert.match(settingsPage, /hasBusinessWorkspace/);
  assert.match(settingsPage, /workspace\.type === "salon"/);
  assert.match(settingsPage, /Business & Salon Terms/);
  assert.doesNotMatch(settingsPage, /usePathname|useSearchParams|localStorage|sessionStorage/);
});

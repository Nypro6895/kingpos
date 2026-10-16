import { HELP_GUIDES, HELP_QUICK_STARTS, HELP_VERSION, type HelpGuide } from "./help-guides";
import { translateHelp, type HelpLanguage } from "./help-language";
import illustrations from "./help-illustrations.json";

export const APP_LOCAL_REFERENCE_VERSION = `${HELP_VERSION.version}:local-1`;
export const APP_LOCAL_HELP_GUIDES = HELP_GUIDES;
export const APP_LOCAL_HELP_QUICK_STARTS = HELP_QUICK_STARTS;
export const APP_LOCAL_HELP_ILLUSTRATIONS = illustrations;
const localizedImages: Record<string, Record<HelpLanguage, Pick<HelpGuide["evidence"]["screenshots"][number], "desktop" | "mobile">>> = illustrations;

/** Complete guide data, translated with the same URL-scoped Help dictionary. */
export function getAppLocalHelpGuide(slug: string, language: HelpLanguage = "vi"): HelpGuide | null {
  const guide = HELP_GUIDES.find(item => item.slug === slug);
  if (!guide) return null;
  const text = (value: string) => translateHelp(value, language);
  return { ...guide, title: text(guide.title), summary: text(guide.summary), prerequisite: text(guide.prerequisite),
    entry: { ...guide.entry, label: text(guide.entry.label) }, notes: guide.notes.map(text),
    steps: guide.steps.map(step => ({ title: text(step.title), body: text(step.body) })),
    sections: guide.sections.map(section => ({ ...section, title: text(section.title), steps: section.steps.map(text), check: text(section.check), example: text(section.example), issues: section.issues.map(text) })),
    evidence: { ...guide.evidence, screenshots: guide.evidence.screenshots.map(screen => ({ ...screen, ...(localizedImages[screen.id]?.[language] ?? {}), caption: text(screen.caption), alt: text(screen.alt) })) },
  };
}

const imagePaths = new Set<string>();
for (const guide of HELP_GUIDES) for (const screen of guide.evidence.screenshots) for (const language of ["en", "vi"] as const) {
  const image = localizedImages[screen.id]?.[language] ?? screen;
  imagePaths.add(image.desktop.src); imagePaths.add(image.mobile.src);
}
export const APP_LOCAL_REFERENCE_ASSETS = [...imagePaths].sort();

/** Public instructions only; private support conversations are never bundled. */
export const APP_LOCAL_SUPPORT_INSTRUCTIONS = {
  version: APP_LOCAL_REFERENCE_VERSION, title: "Report / Contact",
  introduction: "Ask for help and continue conversations with our team.",
  sections: [
    { title: "Find a guide", body: "Read the full customer, owner and staff guides before reporting an issue.", href: "/help" },
    { title: "Send a request", body: "Describe what you were doing, the intended salon, and what happened. Avoid passwords, passcodes and full payment details.", href: "/support" },
    { title: "Without signing in", body: "Use the existing secure contact form. Previous guest conversations require their own secure access.", href: "/contact-support" },
    { title: "Account access", body: "Use account recovery if you cannot sign in. Support instructions do not bypass account or salon permission checks.", href: "/account-recovery" },
  ],
  confirmation: "Sending a support request requires a connection and confirmation from the server.",
} as const;

/** Actual existing UI modules and their required live props; never fabricated data. */
export const APP_LOCAL_REFERENCE_MODULES = {
  helpHome: { source: "components/app-local-help.tsx", export: "AppLocalHelp", props: ["language", "navigate"], content: "APP_LOCAL_HELP_GUIDES" },
  helpGuide: { source: "components/app-local-help.tsx", export: "AppLocalHelp", props: ["slug", "language", "navigate"], content: "getAppLocalHelpGuide" },
  market: { source: "app/market/market-client.tsx", export: "MarketClient", propsLoader: "lib/market-experience-data.ts#loadMarketExperienceData", liveResource: "market.catalog" },
  settings: { source: "app/settings/settings-hub-client.tsx", export: "SettingsHubClient", propsLoader: "app/settings/settings-hub-actions.ts#loadSettingsHub", privateProps: ["user", "index"], onlineOnlySections: ["login-security", "delete-account", "ownership", "close-salon"] },
} as const;

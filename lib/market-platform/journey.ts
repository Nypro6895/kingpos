type JourneyApp = { active: boolean; versions: { id: string; review?: { decision: string } | null }[] };
type CheckReport = { versionId: string; checks: { name: string; passed: boolean }[] };
export type JourneyStep = {
  title: string;
  status: "Observed" | "Pending" | "Evidence unavailable";
  detail: string;
  panel: string;
};

export function developerJourney(input: {
  hasOrganization: boolean;
  apps: JourneyApp[];
  profileAvailable: boolean;
  profileComplete: boolean;
  checks?: CheckReport[];
}): JourneyStep[] {
  const versions = input.apps.flatMap(app => app.versions);
  // Ignore evidence for versions outside this publisher's workspace.
  const reports = input.checks?.filter(report => versions.some(v => v.id === report.versionId));
  const observed = (name: string) => reports?.some(report => report.checks.some(check => check.name === name && check.passed === true));
  const evidenceStatus = (name: string) => !reports ? "Evidence unavailable" as const : observed(name) ? "Observed" as const : "Pending" as const;
  const approved = input.apps.some(app => app.active && app.versions.some(v => v.review?.decision === "approved"));
  return [
    { title: "Account & organization", status: input.hasOrganization ? "Observed" : "Pending", detail: "Use your Reylumi login and register your publisher organization. Team invitations and ownership transfer are not available yet.", panel: "developer" },
    { title: "Publisher profile & account security", status: !input.profileAvailable ? "Evidence unavailable" : input.profileComplete ? "Observed" : "Pending", detail: "Save your support contact and website. Review your personal profile, two-factor authentication, recovery and sessions separately; a saved publisher profile does not verify account security.", panel: "account" },
    { title: "Host & submit a version", status: versions.length ? "Observed" : "Pending", detail: "Upload an immutable JSON connection manifest. Apps run on your HTTPS infrastructure; a submitted manifest does not prove your hosted app is working.", panel: "developer" },
    { title: "Configure the app backend", status: evidenceStatus("Confidential client configured"), detail: "Configure a confidential client on your server. A configured secret is a setup observation, not a completed Owner connection.", panel: "developer" },
    { title: "Test with synthetic salon data", status: evidenceStatus("Synthetic API request observed"), detail: "Create a version-specific sandbox and verify a successful API call. Check tenant isolation, errors, expiry and revocation separately.", panel: "testing" },
    { title: "Independent review & Market", status: approved ? "Observed" : "Pending", detail: "An active app needs an independently approved version to be eligible for Market. Rejected changes require a new version and review. Owner activation and runtime acceptance remain separate.", panel: "developer" },
  ];
}

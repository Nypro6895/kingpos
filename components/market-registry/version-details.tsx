import type { MarketRegistryManifest, MarketRegistrySubmission } from "@/types/market-registry";
import styles from "./registry.module.css";

const FIELDS = [
  { key: "displayName", label: "App name" },
  { key: "appVersion", label: "App version" },
  { key: "description", label: "Description" },
] as const;

export function statusLabel(status: MarketRegistrySubmission["status"] | "draft") {
  return { draft: "Draft", submitted: "In review", metadata_approved: "Details approved", rejected: "Changes requested", withdrawn: "Withdrawn" }[status];
}

export function StatusBadge({ status }: { status: MarketRegistrySubmission["status"] | "draft" }) {
  return <span className={styles.badge} data-status={status === "metadata_approved" ? "approved" : status}>{statusLabel(status)}</span>;
}

export function recordedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(date);
}

export function ManifestDetails({ manifest }: { manifest: MarketRegistryManifest }) {
  return <dl className={styles.metadata}>
    {FIELDS.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{manifest[field.key]}</dd></div>)}
    <div><dt>Data access</dt><dd>None requested</dd></div>
  </dl>;
}

export function ManifestDiff({ previous, current }: { previous: MarketRegistryManifest | null; current: MarketRegistryManifest }) {
  if (!previous) return <p className={styles.muted}>First submission. All app details are new.</p>;
  const changed = FIELDS.filter(field => previous[field.key] !== current[field.key]);
  if (!changed.length) return <p className={styles.muted}>No app details changed from the previous submission.</p>;
  return <table className={styles.diff}>
    <caption className={styles.sectionLabel}>Changes from the previous submission</caption>
    <thead><tr><th scope="col">Field</th><th scope="col">Previous</th><th scope="col">Submitted</th></tr></thead>
    <tbody>{changed.map(field => <tr key={field.key}><th scope="row">{field.label}</th><td>{previous[field.key]}</td><td>{current[field.key]}</td></tr>)}</tbody>
  </table>;
}

export function SubmissionHistory({ submissions }: { submissions: MarketRegistrySubmission[] }) {
  const ordered = [...submissions].sort((a, b) => b.draft_version - a.draft_version);
  return <section className={styles.panel} aria-label="Submission history">
    <div className={styles.panelHeader}><div><h2>Submission history</h2><p>Each submission keeps the exact details sent for review.</p></div><span className={styles.badge}>{ordered.length}</span></div>
    {!ordered.length ? <div className={styles.emptyPanel}><p>No submissions yet.</p><p>Save your app details, then submit them for review.</p></div> :
      <ol className={styles.versionList}>{ordered.map((submission, index) => <li className={styles.versionItem} key={submission.id}>
        <div className={styles.versionHeading}><div><h3>Version {submission.manifest.appVersion} · Revision {submission.draft_version}</h3><p>Submitted {recordedDate(submission.submitted_at)}</p></div><StatusBadge status={submission.status} /></div>
        {submission.review ? <div className={styles.reason}><strong>Reviewer feedback · {recordedDate(submission.review.reviewed_at)}</strong><p>{submission.review.reason}</p></div> : null}
        {submission.withdrawn_at ? <p className={styles.muted}>Withdrawn {recordedDate(submission.withdrawn_at)}</p> : null}
        <details className={styles.details}><summary>View submitted details and changes</summary>
          <ManifestDetails manifest={submission.manifest} />
          <ManifestDiff current={submission.manifest} previous={ordered[index + 1]?.manifest ?? null} />
        </details>
      </li>)}</ol>}
  </section>;
}

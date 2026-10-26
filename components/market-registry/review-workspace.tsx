"use client";

import { useState } from "react";
import { reviewSubmissionAction } from "@/app/(market-private)/actions";
import type { MarketRegistryQueue, MarketRegistryReviewItem } from "@/types/market-registry";
import { RegistryActionForm } from "./action-form";
import { MetadataNotice, RegistryHeader } from "./registry-shell";
import { ManifestDetails, ManifestDiff, recordedDate, StatusBadge } from "./version-details";
import styles from "./registry.module.css";

function ReviewDecisionForm({ item }: { item: MarketRegistryReviewItem }) {
  const [reason, setReason] = useState("");
  return <RegistryActionForm action={reviewSubmissionAction} label={`Decision for ${item.manifest.displayName}`}>
    <input type="hidden" name="submissionId" value={item.id} />
    <input type="hidden" name="expectedVersion" value={item.draft_version} />
    <input type="hidden" name="expectedHash" value={item.manifest_hash} />
    <div className={styles.field}><label htmlFor={`reason-${item.id}`}>Reason or feedback</label><textarea id={`reason-${item.id}`} name="reason" required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain the decision and any changes the publisher should make." aria-describedby={`reason-help-${item.id}`} /><small id={`reason-help-${item.id}`}>Required for either decision. This feedback is visible to the publisher.</small></div>
    <div className={styles.actions}>
      <button className={styles.button} type="submit" name="decision" value="metadata_approved">Approve details</button>
      <button className={styles.dangerButton} type="submit" name="decision" value="rejected">Request changes</button>
      <a className={styles.textButton} href="/market-review">Reload latest queue</a>
    </div>
  </RegistryActionForm>;
}

export function ReviewWorkspace({ queue }: { queue: MarketRegistryQueue }) {
  return <>
    <RegistryHeader eyebrow="App review" title="Review submitted details"><p>Compare each submission with its previous version and leave a clear decision for the publisher.</p></RegistryHeader>
    <MetadataNotice />
    <div className={styles.reviewGrid}>
      {!queue.submissions.length ? <section className={styles.panel}><div className={styles.emptyPanel}><h2>No submissions waiting</h2><p>New submissions from the private workspace will appear here.</p><a className={styles.textButton} href="/market-review">Reload review queue</a></div></section> : queue.submissions.map(item => <article className={styles.panel} key={item.id} aria-label={`Review ${item.manifest.displayName}`}>
        <div className={styles.panelHeader}><div><div className={styles.reviewTitle}><h2>{item.manifest.displayName}</h2><StatusBadge status={item.status} /></div><p>{item.publisher_name} · Version {item.manifest.appVersion} · Revision {item.draft_version}</p><p>Submitted {recordedDate(item.submitted_at)}</p></div></div>
        <div className={styles.panelBody}>
          <ManifestDetails manifest={item.manifest} />
          <ManifestDiff previous={item.previous_manifest} current={item.manifest} />
          {item.status === "submitted" ? <>
            <h3 className={styles.sectionLabel}>Review decision</h3>
            <ReviewDecisionForm item={item} />
          </> : item.review ? <div className={styles.reason}><strong>Recorded decision</strong><p>{item.review.reason}</p></div> : null}
        </div>
      </article>)}
    </div>
  </>;
}

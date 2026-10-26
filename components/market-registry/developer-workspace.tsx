"use client";

import { useState } from "react";
import { saveDraftAction, submitDraftAction, withdrawSubmissionAction } from "@/app/(market-private)/actions";
import type { MarketRegistryApp, MarketRegistryManifest, MarketRegistryWorkspace } from "@/types/market-registry";
import { RegistryActionForm } from "./action-form";
import { MetadataNotice, RegistryHeader } from "./registry-shell";
import { ManifestDetails, StatusBadge, SubmissionHistory } from "./version-details";
import styles from "./registry.module.css";

const EMPTY_MANIFEST: MarketRegistryManifest = { manifestSchemaVersion: 1, appVersion: "1.0.0", displayName: "", description: "", requestedCapabilities: [] };

function currentDraftStatus(app?: MarketRegistryApp) {
  return app?.submissions.find(submission => submission.draft_version === app.draft_version)?.status ?? "draft";
}

function DraftEditor({ app, onCreated }: { app?: MarketRegistryApp; onCreated: () => void }) {
  const [dirty, setDirty] = useState(false);
  const manifest = app?.draft_manifest ?? EMPTY_MANIFEST;
  const [fields, setFields] = useState(manifest);
  const pending = app?.submissions.find(submission => submission.status === "submitted");
  const hasReviewedRevision = app?.submissions.some(submission => submission.draft_version === app.draft_version);

  return <section className={styles.panel} aria-label={app ? "App draft" : "New app draft"}>
    <div className={styles.panelHeader}><div><h2>{app ? "App details" : "Start an app draft"}</h2><p>{app ? `Saved revision ${app.draft_version}` : "Your draft stays private until you submit it for review."}</p></div><StatusBadge status={currentDraftStatus(app)} /></div>
    <div className={styles.panelBody}>
      {pending ? <div className={styles.stack}>
        <p className={styles.muted}>These details are in review and cannot be edited. Withdraw the submission to prepare a new revision.</p>
        <ManifestDetails manifest={pending.manifest} />
        <RegistryActionForm action={withdrawSubmissionAction} label="Withdraw submission">
          <input type="hidden" name="submissionId" value={pending.id} />
          <input type="hidden" name="expectedHash" value={pending.manifest_hash} />
          <div className={styles.actions}><button className={styles.secondaryButton} type="submit">Withdraw submission</button></div>
        </RegistryActionForm>
      </div> : <div className={styles.stack}>
        {hasReviewedRevision ? <p className={styles.muted}>Save a new revision to update or resubmit these details. Previous submissions and feedback stay in your history.</p> : null}
        <RegistryActionForm action={saveDraftAction} label={app ? "Save app draft" : "Create app draft"} onChange={() => setDirty(true)} onSuccess={app ? undefined : onCreated}>
          <input type="hidden" name="appId" value={app?.id ?? ""} />
          <input type="hidden" name="expectedVersion" value={app?.draft_version ?? 0} />
          <div className={styles.fields}>
            <label className={styles.field}><span>App name</span><input name="displayName" autoComplete="off" required maxLength={100} value={fields.displayName} onChange={event => setFields({ ...fields, displayName: event.target.value })} /></label>
            <div className={styles.field}><label htmlFor={`version-${app?.id ?? "new"}`}>App version</label><input id={`version-${app?.id ?? "new"}`} name="appVersion" autoComplete="off" required maxLength={64} value={fields.appVersion} onChange={event => setFields({ ...fields, appVersion: event.target.value })} aria-describedby={`version-help-${app?.id ?? "new"}`} /><small id={`version-help-${app?.id ?? "new"}`}>For example, 1.0.0 or 1.0.0-beta.1.</small></div>
            <div className={`${styles.field} ${styles.fullWidth}`}><label htmlFor={`description-${app?.id ?? "new"}`}>Description</label><textarea id={`description-${app?.id ?? "new"}`} name="description" required maxLength={2000} value={fields.description} onChange={event => setFields({ ...fields, description: event.target.value })} placeholder="Explain what your app will help salons do." aria-describedby={`description-help-${app?.id ?? "new"}`} /><small id={`description-help-${app?.id ?? "new"}`}>Up to 2,000 characters. Use plain text; do not include secrets or customer information.</small></div>
          </div>
          <div className={styles.actions}><button className={styles.button} type="submit">{app ? hasReviewedRevision ? "Save new revision" : "Save draft" : "Create draft"}</button>{app ? <a className={styles.textButton} href="/developers/market">Reload saved details</a> : null}</div>
        </RegistryActionForm>
        {app ? <RegistryActionForm action={submitDraftAction} label="Submit saved draft">
          <input type="hidden" name="appId" value={app.id} />
          <input type="hidden" name="expectedVersion" value={app.draft_version} />
          <div className={styles.actions}><button className={styles.secondaryButton} type="submit" disabled={dirty || hasReviewedRevision}>Submit saved draft</button><span className={styles.muted}>{dirty ? "Save your changes before submitting." : hasReviewedRevision ? "Save a new revision before submitting again." : "The saved details will be locked while in review."}</span></div>
        </RegistryActionForm> : null}
      </div>}
    </div>
  </section>;
}

export function DeveloperWorkspace({ workspace }: { workspace: MarketRegistryWorkspace }) {
  const [selection, setSelection] = useState<string | null>(workspace.apps[0]?.id ?? null);
  const [creatingFrom, setCreatingFrom] = useState<string[] | null>(null);
  const created = creatingFrom && workspace.apps.find(app => !creatingFrom.includes(app.id));
  if (created) {
    setSelection(created.id);
    setCreatingFrom(null);
  }
  const selected = workspace.apps.find(app => app.id === (created?.id ?? selection));
  const waiting = selected?.submissions.find(submission => submission.status === "submitted");
  return <>
    <RegistryHeader eyebrow={workspace.publisher.name} title="Build your next app"><p>Prepare your app details, send a version for review, and keep track of feedback.</p></RegistryHeader>
    <MetadataNotice />
    <div className={styles.columns}>
      <section className={styles.panel} aria-label="Your apps">
        <div className={styles.panelHeader}><h2>Your apps</h2><span className={styles.badge}>{workspace.apps.length}</span></div>
        <div className={styles.appList}>
          {workspace.apps.map(app => <button type="button" key={app.id} className={styles.appButton} aria-pressed={selected?.id === app.id} onClick={() => setSelection(app.id)}>
            <strong>{app.draft_manifest.displayName}</strong><span>Version {app.draft_manifest.appVersion} · Revision {app.draft_version}</span>
            <StatusBadge status={currentDraftStatus(app)} />
          </button>)}
          <button type="button" className={styles.secondaryButton} onClick={() => setSelection(null)} aria-pressed={!selected}>New app draft</button>
        </div>
      </section>
      <div className={styles.stack}>
        <DraftEditor key={selected ? `${selected.id}:${selected.draft_version}:${waiting?.id ?? "editable"}` : "new"} app={selected} onCreated={() => setCreatingFrom(workspace.apps.map(app => app.id))} />
        {selected ? <SubmissionHistory submissions={selected.submissions} /> : <p className={styles.muted}>Saved drafts are available when you return with this publisher account.</p>}
      </div>
    </div>
  </>;
}

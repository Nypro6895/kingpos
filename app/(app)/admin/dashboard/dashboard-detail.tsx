"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { PLATFORM_ADMIN_PERMISSIONS as P, PLATFORM_REPORT_PRIORITIES } from "@/types/platform-admin";
import type { DashboardDetail } from "@/types/admin-dashboard";
import type { DashboardQueueItem } from "@/lib/admin-dashboard-model";
import { ClaimAttachment } from "../claims/review-controls";
import { VerificationAttachmentButton } from "../verification/attachment-button";
import { SupportComposer } from "../inbox/support-composer";
import { updateSupportThreadAction, resolveSupportDeliveryAction } from "../inbox/actions";
import { supportMailto, SUPPORT_STATUSES, SUPPORT_STATUS_LABELS } from "@/lib/support-rules";
import { DashboardActionForm } from "./dashboard-action-form";
import { dashboardCaseAction, dashboardCancelDeletionAction, dashboardLocationNoteAction, dashboardRecoveryAction, dashboardSafetyAction, reviewDashboardRequestAction } from "./actions";
import type { AdminActionResult } from "../_components/action-form";

function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(value)) + " CT";
}
function Hidden({ name, value }: { name: string; value: string | null }) { return <input type="hidden" name={name} value={value ?? ""} />; }
function Facts({ children }: { children: ReactNode }) { return <dl className="dashboard-facts">{children}</dl>; }
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children || "—"}</dd></div>; }
function Reason({ name = "reason", label = "Decision reason" }: { name?: string; label?: string }) { return <label>{label}<textarea name={name} required minLength={3} maxLength={1000} rows={2} placeholder="Explain this action…" /></label>; }
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="dashboard-detail-section"><h3>{title}</h3>{children}</section>; }

export function DashboardDetailPanel({ data, item, onComplete }: { data: DashboardDetail; item: DashboardQueueItem; onComplete: (result: AdminActionResult) => void }) {
  const can = (permission: string) => data.permissions.includes(permission);
  const [reviewMode, setReviewMode] = useState("approved");
  const [notificationId, setNotificationId] = useState(() => crypto.randomUUID());
  const fullDetails = <Link href={item.href} className="dashboard-link">Open full details ↗</Link>;
  const userLink = (id: string, label: string) => can(P.usersRead) ? <Link href={`/admin/users/${id}`} className="dashboard-link">{label}</Link> : label;

  if (data.kind === "claims" || data.kind === "verification") {
    const row = data.request;
    const isClaim = data.kind === "claims";
    const actionable = row.status === "waiting" && (isClaim || data.latest);
    const canApprove = isClaim ? data.canApprove : data.latest;
    const files = row.attachments ?? [];
    return <div className="dashboard-detail-grid">
      <Panel title={`${isClaim ? "Ownership claim" : "Verification"} · ${item.reference}`}>
        <Facts><Fact label="Salon"><Link className="dashboard-link" href={`/admin/locations/${row.salon_id}`}>{row.salon_name}</Link></Fact><Fact label="Applicant">{userLink(row.applicant_user_id, isClaim ? data.request.applicant_name || "Reylumi user" : "View applicant")}</Fact>
          {isClaim && data.request.applicant_email && <Fact label="Email">{data.request.applicant_email}</Fact>}
          <Fact label="Submitted">{date(isClaim ? row.created_at : data.request.submitted_at || row.created_at)}</Fact><Fact label="Status">{row.status.replaceAll("_", " ")}</Fact><Fact label="Address">{row.address}</Fact>
          {isClaim && <Fact label="Phone check">{data.request.phone_verified_at ? "Confirmed" : "Not confirmed"}</Fact>}
        </Facts>
        {isClaim && data.request.support_reason && <p className="dashboard-body">{data.request.support_reason}</p>}
        <details className="dashboard-history"><summary>Request history</summary>{isClaim ? data.request.events?.map((event, i) => <p key={i}>{date(event.created_at)} · {event.event} · {event.reason}</p>) : data.request.decisions?.map((event, i) => <p key={i}>{date(event.created_at)} · {event.decision} · {event.reason}</p>)}</details>
        {fullDetails}
      </Panel>
      <Panel title="Evidence & internal notes">
        {files.length ? <ul className="dashboard-attachments">{files.map(file => <li key={file.path}>{isClaim ? <ClaimAttachment requestId={row.id} path={file.path} name={file.name} /> : <VerificationAttachmentButton requestId={row.id} path={file.path} name={file.name} />}</li>)}</ul> : <p className="dashboard-muted">No documents attached.</p>}
        {data.notes.map(note => <div className="dashboard-note" key={note.id}><p>{note.body}</p><small>{note.author?.display_name || "Admin"} · {date(note.created_at)}</small></div>)}
        {can(P.notesCreate) && <DashboardActionForm action={dashboardLocationNoteAction} onComplete={onComplete} resetOnSuccess><Hidden name="target_type" value="location" /><Hidden name="target_id" value={row.salon_id} /><Hidden name="return_path" value="/admin" /><label>Internal note<textarea name="body" required maxLength={5000} rows={2} placeholder="Add a note to the salon record…" /></label><button className="dashboard-button">Save note</button></DashboardActionForm>}
      </Panel>
      <Panel title="Decision">
        {!actionable ? <p className="dashboard-muted">This request is no longer awaiting a decision. Refresh the queue.</p> : can(P.locationsUpdateStatus) ? <>
          <p className="dashboard-muted">Review the evidence before deciding.</p>
          <div className="dashboard-button-row dashboard-decision-modes"><button type="button" className={`dashboard-button ${reviewMode === "approved" ? "is-selected" : ""}`} disabled={!canApprove} onClick={() => setReviewMode("approved")}>Approve{isClaim ? " claim" : ""}</button>{can(P.notificationsSend) && <button type="button" className={`dashboard-button ${reviewMode === "request_info" ? "is-selected" : ""}`} onClick={() => setReviewMode("request_info")}>Request info</button>}<button type="button" className={`dashboard-button dashboard-button-danger ${reviewMode === "rejected" ? "is-selected" : ""}`} onClick={() => setReviewMode("rejected")}>Reject</button>{!isClaim && <button type="button" className={`dashboard-button dashboard-button-danger ${reviewMode === "blocked" ? "is-selected" : ""}`} onClick={() => setReviewMode("blocked")}>Block requests</button>}</div>
          {!canApprove && <p className="dashboard-muted">Existing management requires an owner invitation or recovery. Approval cannot replace the owner.</p>}
          {(reviewMode !== "approved" || canApprove) && <DashboardActionForm key={reviewMode} action={reviewDashboardRequestAction} onComplete={result => { if (result.ok) setNotificationId(crypto.randomUUID()); onComplete(result); }} confirmMessage={reviewMode === "request_info" ? "Send this information request to the applicant's in-app inbox?" : `Confirm ${reviewMode === "approved" ? "approval" : reviewMode === "blocked" ? "blocking further verification requests" : "rejection"} of this application?`}>
            <Hidden name="kind" value={data.kind} /><Hidden name="request_id" value={row.id} /><Hidden name="decision" value={reviewMode} /><Hidden name="notification_request_id" value={notificationId} />
            {reviewMode === "request_info" && <><p className="dashboard-muted">Delivered in-app. The application stays waiting.</p><label>Message to applicant<textarea name="body" required maxLength={2000} rows={3} /></label></>}
            <Reason label={reviewMode === "request_info" ? "Internal send reason" : "Decision reason"} /><button className={`dashboard-button ${reviewMode === "rejected" || reviewMode === "blocked" ? "dashboard-button-danger" : "dashboard-button-primary"}`}>{reviewMode === "request_info" ? "Send information request" : reviewMode === "approved" ? "Approve application" : reviewMode === "blocked" ? "Block verification requests" : "Reject application"}</button>
          </DashboardActionForm>}
        </> : <p className="dashboard-muted">Your role has read-only access to decisions.</p>}
      </Panel>
    </div>;
  }
  if (data.kind === "inbox") {
    const { thread, messages } = data.detail;
    const needsReview = messages.some(message => message.kind === "email_reply" && ["sending", "unknown"].includes(message.delivery_status));
    return <div className="dashboard-detail-grid dashboard-detail-grid-support">
      <Panel title="Conversation"><Facts><Fact label="Customer">{thread.customer_name}</Fact><Fact label="Email"><a className="dashboard-link" href={supportMailto(thread.customer_email, item.reference)}>{thread.customer_email}</a></Fact><Fact label="Received">{date(thread.created_at)}</Fact></Facts><p className="dashboard-body">{thread.message}</p>
        <details className="dashboard-history"><summary>Conversation history ({messages.length})</summary>{messages.map(message => <div className="dashboard-note" key={message.id}><strong>{message.kind.replaceAll("_", " ")} · {message.delivery_status}</strong><p>{message.body}</p><small>{message.actor_name || "Admin"} · {date(message.created_at)}</small>{message.failure_reason && <p className="dashboard-error">{message.failure_reason}</p>}
          {can(P.inboxReply) && message.kind === "email_reply" && ["sending", "unknown"].includes(message.delivery_status) && <DashboardActionForm action={resolveSupportDeliveryAction} onComplete={onComplete} confirmMessage="Record the delivery outcome you verified in the email provider? This does not resend the reply."><Hidden name="message_id" value={message.id} /><label>Verified delivery outcome<select name="outcome"><option value="sent">Accepted by email service</option><option value="failed">Not sent</option></select></label><Reason label="Delivery review reason" /><button className="dashboard-button">Record delivery outcome</button></DashboardActionForm>}
        </div>)}</details>{fullDetails}</Panel>
      <Panel title="Reply & notes">{can(P.inboxManage) || can(P.inboxReply) ? <><p className="dashboard-muted">{data.emailReady ? "Preview your reply before sending." : "Email is not connected. You can save an internal note or record a reply sent outside Reylumi."}</p><SupportComposer threadId={thread.id} recipient={thread.customer_email} from={data.emailFrom} emailReady={data.emailReady} canReply={can(P.inboxReply)} canManage={can(P.inboxManage)} blocked={needsReview || thread.status === "spam"} onComplete={onComplete} /></> : <p className="dashboard-muted">Your role has read-only access.</p>}</Panel>
      <Panel title="Handling"><p className="dashboard-muted">{data.detail.assignee ? `Assigned to ${data.detail.assignee}` : "Unassigned"}</p>{can(P.inboxManage) && <DashboardActionForm action={updateSupportThreadAction} onComplete={onComplete}><Hidden name="thread_id" value={thread.id} /><label>Status<select name="status" defaultValue={thread.status}>{SUPPORT_STATUSES.map(status => <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>)}</select></label><label>Assignment<select name="assignment"><option value="keep">Keep current assignment</option><option value="me">Assign to me</option><option value="unassign">Unassign</option></select></label><button className="dashboard-button dashboard-button-primary">Save handling</button></DashboardActionForm>}<a href={supportMailto(thread.customer_email, item.reference)} className="dashboard-link">Open email ↗</a></Panel>
    </div>;
  }
  if (data.kind === "cases") {
    const { report, subject, notes } = data.detail;
    const active = !["resolved", "closed"].includes(report.status);
    const canReadSubject = subject && can(subject.type === "business" ? P.businessesRead : subject.type === "location" ? P.locationsRead : P.usersRead);
    return <div className="dashboard-detail-grid">
      <Panel title={`Support case · ${report.report_number}`}><Facts><Fact label="Summary">{report.summary}</Fact><Fact label="Status">{report.status.replaceAll("_", " ")}</Fact><Fact label="Priority">{report.priority}</Fact><Fact label="Subject">{subject ? canReadSubject ? <Link className="dashboard-link" href={`/admin/${subject.type === "business" ? "businesses" : subject.type === "location" ? "locations" : "users"}/${subject.id}`}>{subject.label}</Link> : subject.label : "—"}</Fact><Fact label="Created">{date(report.created_at)}</Fact></Facts><p className="dashboard-body">{report.description || "No description provided."}</p>{report.resolution && <p className="dashboard-body">Resolution: {report.resolution}</p>}{fullDetails}
        {can(P.notesRead) && <details className="dashboard-history"><summary>Internal notes ({notes.length})</summary>{notes.map(note => <div className="dashboard-note" key={note.id}><p>{note.body}</p><small>{note.author?.display_name || "Admin"} · {date(note.created_at)}</small></div>)}</details>}
        {can(P.notesCreate) && <DashboardActionForm action={dashboardCaseAction} onComplete={onComplete} resetOnSuccess><Hidden name="operation" value="note" /><Hidden name="target_type" value="report" /><Hidden name="target_id" value={report.id} /><Hidden name="return_path" value="/admin" /><label>Internal note<textarea name="body" required maxLength={5000} rows={2} /></label><button className="dashboard-button">Save note</button></DashboardActionForm>}
      </Panel>
      <Panel title="Assignment & status">
        {can(P.reportsAssign) && <DashboardActionForm action={dashboardCaseAction} onComplete={onComplete}><Hidden name="operation" value="assign" /><Hidden name="report_id" value={report.id} /><label>Assigned to<select name="assigned_membership_id" defaultValue={report.assigned_membership_id ?? ""}><option value="">Unassigned</option>{data.assignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name || "Admin"} · {assignee.role}</option>)}</select></label><Reason label="Assignment reason" /><button className="dashboard-button">Save assignment</button></DashboardActionForm>}
        {can(P.reportsUpdate) && active && <DashboardActionForm action={dashboardCaseAction} onComplete={onComplete}><Hidden name="operation" value="update" /><Hidden name="report_id" value={report.id} /><label>Summary<input name="summary" required defaultValue={report.summary} maxLength={200} /></label><Hidden name="description" value={report.description} /><label>Status<select name="status" defaultValue={report.status}>{["new", "under_review", "action_required"].map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label><label>Priority<select name="priority" defaultValue={report.priority}>{PLATFORM_REPORT_PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></label><Reason label="Change reason" /><button className="dashboard-button">Update case</button></DashboardActionForm>}
      </Panel>
      <Panel title="Resolution">{can(P.reportsResolve) && report.status !== "closed" ? <>{active && <DashboardActionForm action={dashboardCaseAction} onComplete={onComplete} confirmMessage="Apply the selected resolution action to this case?"><Hidden name="operation" value="resolve" /><Hidden name="report_id" value={report.id} /><label>Resolution<textarea name="resolution" required minLength={3} maxLength={5000} rows={3} /></label><Reason /><div className="dashboard-button-row"><button className="dashboard-button dashboard-button-primary">Resolve case</button><button className="dashboard-button" name="operation" value="resolve_close">Resolve & close</button></div></DashboardActionForm>}{report.status === "resolved" && <DashboardActionForm action={dashboardCaseAction} onComplete={onComplete} confirmMessage="Close this resolved case?"><Hidden name="operation" value="close" /><Hidden name="report_id" value={report.id} /><Reason label="Close reason" /><button className="dashboard-button">Close case</button></DashboardActionForm>}</> : <p className="dashboard-muted">{active ? "Your role cannot resolve cases." : "This case is complete."}</p>}</Panel>
    </div>;
  }
  if (data.kind === "post_safety") {
    const row = data.detail;
    return <div className="dashboard-detail-grid">
      <Panel title="Reported content"><p className="dashboard-body">{row.content_snapshot.title}<br />{row.content_snapshot.caption || "No caption"}</p><div className="dashboard-media">{data.mediaUrls.map(url => <a href={url} key={url} target="_blank" rel="noreferrer"><Image unoptimized src={url} alt="Post under review" width={200} height={150} /></a>)}</div>{fullDetails}</Panel>
      <Panel title="Review context"><Facts><Fact label="Origin">{row.origin === "automatic" ? "Automatic moderation hold" : "User report"}</Fact><Fact label="Reason">{row.reason.replaceAll("_", " ")}</Fact><Fact label="Matched terms">{row.matched_keywords?.join(", ") || "—"}</Fact><Fact label="Submitted">{date(row.created_at)}</Fact><Fact label="Author">{row.author_user_id ? userLink(row.author_user_id, "View account") : "—"}</Fact></Facts>{row.platform_report_id && <Link href={`/admin/reports/${row.platform_report_id}`} className="dashboard-link">Related support case ↗</Link>}<p className="dashboard-muted">User reports hide content for the reporter. Automatic holds await a moderation decision.</p></Panel>
      <Panel title="Decision">{can(P.reportsUpdate) && row.status === "pending" ? <DashboardActionForm action={dashboardSafetyAction} onComplete={onComplete} confirmMessage="Apply this moderation decision to the post?"><Hidden name="caseId" value={row.id} /><label>Action<select name="action"><option value={row.origin === "automatic" ? "allow" : "dismiss"}>{row.origin === "automatic" ? "Allow post" : "Dismiss report"}</option><option value="delete">Delete post</option>{can(P.usersSuspend) && <option value="block">Delete post & suspend author</option>}</select></label><Reason /><button className="dashboard-button dashboard-button-primary">Apply decision</button></DashboardActionForm> : <p className="dashboard-muted">{row.status === "pending" ? "Your role has read-only access." : "This post has already been reviewed."}</p>}</Panel>
    </div>;
  }
  if (data.kind === "pending_deletion") {
    const { user, organization_memberships, salon_memberships } = data.detail;
    return <div className="dashboard-detail-grid">
      <Panel title="Account deletion"><Facts><Fact label="User">{userLink(user.id, user.display_name || "Unnamed user")}</Fact><Fact label="Status">{user.status.replaceAll("_", " ")}</Fact><Fact label="Requested">{date(user.deletion_requested_at ?? null)}</Fact><Fact label="Scheduled for">{date(user.deletion_scheduled_for ?? null)}</Fact></Facts>{fullDetails}</Panel>
      <Panel title="Linked memberships">{[...organization_memberships.map(member => ({ id: member.organization_id, name: member.organization_name, role: member.role, href: `/admin/businesses/${member.organization_id}`, permission: P.businessesRead })), ...(salon_memberships ?? []).map(member => ({ id: member.salon_id, name: member.salon_name, role: member.role, href: `/admin/locations/${member.salon_id}`, permission: P.locationsRead }))].map((member, index) => <p key={`${member.id}:${index}`}>{can(member.permission) ? <Link className="dashboard-link" href={member.href}>{member.name}</Link> : member.name} · {member.role}</p>)}<p className="dashboard-muted">Review ownership and membership context before changing the deletion request.</p></Panel>
      <Panel title="Recovery action">{can(P.usersDelete) && user.status === "pending_deletion" ? <DashboardActionForm action={dashboardCancelDeletionAction} onComplete={onComplete} confirmMessage="Cancel the scheduled deletion and restore the previous account status?"><Hidden name="user_id" value={user.id} /><Reason label="Cancellation reason" /><button className="dashboard-button dashboard-button-primary">Cancel pending deletion</button></DashboardActionForm> : <p className="dashboard-muted">{user.status === "pending_deletion" ? "Your role cannot cancel deletion requests." : "This account is no longer pending deletion."}</p>}</Panel>
    </div>;
  }
  const row = data.detail;
  return <div className="dashboard-detail-grid">
    <Panel title={`Account recovery · ${item.reference}`}><Facts><Fact label="Account">{userLink(row.user_id, "View user")}</Fact><Fact label="Request">{row.request_type.replaceAll("_", " ")}</Fact><Fact label="Risk">{row.risk_level}</Fact><Fact label="Created">{date(row.created_at)}</Fact></Facts><p className="dashboard-body">{row.details || "No details provided."}</p>{fullDetails}<details className="dashboard-history"><summary>Case history</summary>{data.events.map(event => <p key={event.id}>{date(event.created_at)} · {event.event_type.replaceAll("_", " ")} · {event.note}</p>)}</details></Panel>
    <Panel title="Case handling">{can(P.recoveryManage) ? <DashboardActionForm action={dashboardRecoveryAction} onComplete={onComplete}><Hidden name="request_id" value={row.id} /><Hidden name="operation" value="update" /><label>Status<select name="status" defaultValue={row.status}>{["open", "reviewing", "needs_info", "approved", "denied", "resolved", "cancelled"].map(status => <option key={status}>{status}</option>)}</select></label><label>Priority<select name="priority" defaultValue={row.priority}>{PLATFORM_REPORT_PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></label><label>Risk level<select name="risk_level" defaultValue={row.risk_level}>{["unknown", "low", "medium", "high", "critical"].map(risk => <option key={risk}>{risk}</option>)}</select></label><label>Resolution summary<textarea name="resolution_summary" defaultValue={row.resolution_summary ?? ""} maxLength={5000} rows={2} /></label><Reason name="note" label="Handling reason" /><button className="dashboard-button dashboard-button-primary">Save recovery case</button></DashboardActionForm> : <p className="dashboard-muted">Your role has read-only access.</p>}</Panel>
    <Panel title="Account security">{can(P.recoveryManage) && <DashboardActionForm action={dashboardRecoveryAction} onComplete={onComplete} confirmMessage="Revoke this account's sessions and trusted devices for recovery review?"><Hidden name="request_id" value={row.id} /><Hidden name="operation" value="secure" /><Reason name="note" label="Security reason" /><button className="dashboard-button dashboard-button-danger">Secure account sessions</button></DashboardActionForm>}<p className="dashboard-muted">Use the full recovery page to inspect login activity and trusted devices.</p></Panel>
  </div>;
}

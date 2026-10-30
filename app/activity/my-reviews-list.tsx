"use client";
import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { VisitExperiencePrompt } from "./visit-experience-prompt";
import type { MyReviewsData } from "@/types/customer-review";

export function MyReviewsList({ rows, page, focused, error }: MyReviewsData) {
  if (error) return <section role="alert" className="grid gap-3 bg-white p-5"><h1 className="text-xl font-semibold"><WorkspaceText text="My Reviews" /></h1><p><WorkspaceText text={error} /></p><Link href="/more/reviews"><WorkspaceText text="Try again" /></Link></section>;
  return <section className="grid min-w-0 gap-4">
    <h1 className="text-xl font-semibold"><WorkspaceText text="My Reviews" /></h1>
    <p className="text-sm leading-6 text-text-secondary"><WorkspaceText text="Your shared experiences and salon replies. The number of reviews here may differ from the independent customer sample used by LUMI Truth." /></p>
    {focused ? <Link className="min-h-11 text-brand-teal underline" href="/more/reviews"><WorkspaceText text="All my reviews" /></Link> : null}
    {rows.length === 0 ? <div className="grid gap-3 bg-white p-5"><p><WorkspaceText text="No shared experiences yet." /></p><Link className="min-h-11 text-brand-teal underline" href="/activity"><WorkspaceText text="Review a visit in Activity" /></Link></div> : rows.slice(0,10).map(review => <article key={review.id} id={`experience-${review.id}`} className="grid min-w-0 gap-3 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-semibold">{review.salon_name}</h2><span className="text-xs"><WorkspaceText text={review.verified ? "Verified Visit" : "Experience"} /></span></div>
      <p className="text-xs text-text-secondary"><time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric",timeZone:"America/Chicago"})}</time>{review.edited_at ? <> · <WorkspaceText text="Edited" /></> : null}</p>
      <p className="font-medium"><WorkspaceText text={review.feedback_state === "issue" ? "Issue shared" : review.feedback_state === "good" ? "Good experience" : "Experience"} /></p>
      {review.body ? <p className="whitespace-pre-wrap break-words text-sm leading-6">{review.body}</p> : <p className="text-sm text-text-secondary"><WorkspaceText text="Quick feedback, no details added." /></p>}
      {review.reply_body ? <div className="grid gap-2 border-l-2 border-brand-teal bg-surface-muted p-3"><p className="text-xs font-semibold"><WorkspaceText text="Salon reply" /></p><p className="whitespace-pre-wrap break-words text-sm leading-6">{review.reply_body}</p>{review.reply_created_at ? <time className="text-xs text-text-secondary" dateTime={review.reply_created_at}>{new Date(review.reply_created_at).toLocaleDateString("en-US",{timeZone:"America/Chicago"})}</time> : null}</div> : null}
      {review.feedback_state === "issue" ? <p className="text-xs leading-5 text-text-secondary"><WorkspaceText text={review.issue_status === "resolved" ? "Salon marked this issue as handled. This does not change your feedback or its eligibility for LUMI Truth." : review.issue_status === "acknowledged" ? "The salon has acknowledged your issue." : "Awaiting a salon response."} /></p> : null}
      {review.verified && review.ticket_id && review.feedback_state ? <VisitExperiencePrompt key={`${review.id}:${review.edited_at}`} compact actionLabel="Edit my feedback" countsTowardReputation={false} initialBody={review.body} initialState={review.feedback_state} salonName={review.salon_name} ticketId={review.ticket_id} windowDays={0} /> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-brand-teal">{review.ticket_id ? <Link className="flex min-h-11 items-center underline" href={`/activity/receipts/${review.ticket_id}`}><WorkspaceText text="View receipt" /></Link> : null}{review.salon_public ? <Link className="flex min-h-11 items-center underline" href={`/explore/salons/${review.salon_id}#customer-experiences`}><WorkspaceText text="View salon experiences" /></Link> : null}</div>
    </article>)}
    {!focused ? <nav aria-label="Review pages" className="flex flex-wrap gap-5 text-sm text-brand-teal">{page>1 ? <Link className="min-h-11 underline" href={`/more/reviews?page=${page-1}`}><WorkspaceText text="Previous" /></Link> : null}{rows.length>10 && page<1001 ? <Link className="min-h-11 underline" href={`/more/reviews?page=${page+1}`}><WorkspaceText text="Next" /></Link> : null}</nav> : null}
  </section>;
}

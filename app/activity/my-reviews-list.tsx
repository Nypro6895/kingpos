"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { resolveMyVisitExperienceAction } from "./experience-actions";
import type { MyReview, MyReviewsData } from "@/types/customer-review";
import styles from "./visit-feedback.module.css";
import { SocialTextReportButton } from "@/components/social-text-report-button";
function date(value: string) { return new Date(value).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric",timeZone:"America/Chicago"}); }
function ReviewCard({ review }: { review: MyReview }) {
  const [resolved,setResolved]=useState(Boolean(review.customer_resolved_at));
  const [error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  const busy=useRef(false);
  function resolve() {
    if(busy.current) return;
    busy.current=true;
    startTransition(async()=>{
      setError("");
      try { const result=await resolveMyVisitExperienceAction(review.id); if(result.error) setError(result.error); else setResolved(true); }
      catch { setError("Resolution could not be saved. Please try again."); }
      finally { busy.current=false; }
    });
  }
  return <article id={"experience-"+review.id} className={styles.card}>
    <div className={styles.head}><h2>{review.salon_name}</h2><span className={styles.sentiment} data-issue={review.feedback_state === "issue"}><WorkspaceText text={review.feedback_state === "issue" ? "Had an issue" : review.feedback_state === "good" ? "Good experience" : "Experience"} /></span></div>
    <div className={styles.meta}><span><WorkspaceText text="Shared" /> <time dateTime={review.created_at}>{date(review.created_at)}</time>{review.edited_at ? <> · <WorkspaceText text="Edited" /></> : null}</span>{review.ticket_id ? <Link className={styles.link} href={"/activity/receipts/"+review.ticket_id}><WorkspaceText text="Receipt" /></Link> : null}</div>
    <p className={review.body ? styles.body : styles.muted}>{review.body || <WorkspaceText text="Shared without a written comment." />}</p>
    {review.reply_body ? <div className={styles.reply}><div className={styles.replyHead}><strong><WorkspaceText text="Salon reply" /></strong>{review.reply_created_at ? <time dateTime={review.reply_created_at}>{date(review.reply_created_at)}</time> : null}</div><p className={styles.body}>{review.reply_body}</p><SocialTextReportButton target={{kind:review.source === "legacy_review" ? "own_review_reply" : "own_experience_reply",id:review.id}}/></div> : null}
    {review.feedback_state === "issue" ? resolved ? <p role="status" className={styles.resolved}><WorkspaceText text="Resolved · Confirmed by you" /></p> : review.reply_body ? <div className={styles.resolution}><span><WorkspaceText text="Issue resolved?" /></span><button type="button" disabled={pending} onClick={resolve} className={styles.link}><WorkspaceText text={pending ? "Saving…" : "Mark as resolved"} /></button></div> : <p className={styles.muted}><WorkspaceText text="Awaiting salon reply." /></p> : null}
    {error ? <p role="alert" className={styles.error}><WorkspaceText text={error} /></p> : null}
  </article>;
}
export function MyReviewsList({ rows, page, focused, error }: MyReviewsData) {
  if (error) return <section role="alert" className={styles.list}><h1 className={styles.title}><WorkspaceText text="My reviews" /></h1><p><WorkspaceText text={error} /></p><Link className={styles.link} href="/more/reviews"><WorkspaceText text="Try again" /></Link></section>;
  return <section className={styles.list}>
    <div><h1 className={styles.title}><WorkspaceText text="My reviews" /></h1><p className={styles.muted}><WorkspaceText text="Your feedback and salon replies." /></p></div>
    {focused ? <Link className={styles.link} href="/more/reviews"><WorkspaceText text="View all reviews" /></Link> : null}
    {rows.length === 0 ? <div><p className={styles.muted}><WorkspaceText text={focused ? "This review is unavailable." : "No reviews yet."} /></p><Link className={styles.link} href="/my-bookings?tab=history"><WorkspaceText text="View visit history" /></Link></div> : rows.slice(0,10).map(review => <ReviewCard key={review.id} review={review} />)}
    {!focused ? <nav aria-label="Experience pages" className={styles.pagination}>{page>1 ? <Link className={styles.link} href={"/more/reviews?page="+(page-1)}><WorkspaceText text="Previous" /></Link> : null}{rows.length>10 && page<1001 ? <Link className={styles.link} href={"/more/reviews?page="+(page+1)}><WorkspaceText text="Next" /></Link> : null}</nav> : null}
  </section>;
}

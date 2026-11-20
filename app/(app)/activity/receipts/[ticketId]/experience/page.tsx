import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { getCustomerActivityReceipt } from "@/lib/customer-activity";
import { VisitExperiencePrompt } from "@/app/activity/visit-experience-prompt";
import styles from "@/app/activity/visit-feedback.module.css";

async function VisitExperiencePage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const result = await getCustomerActivityReceipt(ticketId);
  if (!result.ok) {
    if (result.code === "sign_in_required") redirect(`/login?next=${encodeURIComponent(`/activity/receipts/${ticketId}/experience`)}`);
    return <main className={styles.formPage}><p role="alert"><WorkspaceText text="Your visit could not be loaded. Please try again." /></p><Link className={styles.link} href={`/activity/receipts/${ticketId}/experience`}><WorkspaceText text="Try again" /></Link></main>;
  }
  const receipt = result.data;
  if (!receipt?.verifiedVisit) notFound();
  const visit = receipt.verifiedVisit;
  if (visit.experienceState) redirect(visit.experienceId ? `/more/reviews?experience=${visit.experienceId}` : "/more/reviews");
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date(receipt.closedAt ?? receipt.openedAt));
  return <main className={styles.formPage}>
    <Link className={styles.link} href="/my-bookings?tab=history"><WorkspaceText text="← History" /></Link>
    <div className="grid gap-5">
      <h1 className={styles.title}><WorkspaceText text="Share experience" /></h1>
      <div><p className="font-semibold">{receipt.salon.name}</p><p className={styles.muted}><WorkspaceText text="Visit" /> · {date}</p></div>
      <VisitExperiencePrompt ticketId={ticketId} salonName={receipt.salon.name} countsTowardReputation={visit.countsTowardReputation} windowDays={visit.windowDays} />
    </div>
  </main>;
}
export default withExperiencePage(VisitExperiencePage);

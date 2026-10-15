import { withExperiencePage } from "@/components/experience-page";
import { redirect } from "next/navigation";
import Link from "next/link";
import { connection } from "next/server";
import { WorkspaceText } from "@/components/workspace-language";
import { marketPluginContext } from "@/lib/market-plugins";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { bookingDepositState } from "@/lib/booking-deposit";
import { bookingDepositPurchaseState } from "@/lib/booking-deposit-market";
import { BookingDepositPanel } from "@/app/market/booking-deposit-panel";
import styles from "@/app/market/booking-deposit-product.module.css";

async function BookingDepositSettingsPage({ searchParams }: { searchParams: Promise<{ salon?: string; confirmed?: string }> }) {
  await connection();
  const [context, query] = await Promise.all([getRequestBusinessContext(), searchParams]);
  if (!context.user) redirect(`/login?next=${encodeURIComponent(`/market/booking-deposit/settings?salon=${query.salon ?? ""}`)}`);
  let salonId: string;
  try { salonId = (await marketPluginContext()).salonId; }
  catch { redirect("/market/booking-deposit"); }
  if (query.salon && query.salon !== salonId) return <main className={styles.settingsPage}><h1>Booking Deposit</h1><p role="alert"><WorkspaceText text="Select the salon used for this purchase, then try again." /></p><Link href="/market/booking-deposit"><WorkspaceText text="Back to plugin" /></Link></main>;
  const [purchase, state] = await Promise.all([bookingDepositPurchaseState(salonId), bookingDepositState(salonId)]);
  if (!purchase.paid || !state.installed) redirect("/market/booking-deposit");
  return <main className={styles.settingsPage}>
    <Link className={styles.back} href="/market/booking-deposit">← <WorkspaceText text="Back to plugin" /></Link>
    <h1>Booking Deposit</h1><p className={styles.settingsIntro}><WorkspaceText text="Choose how much customers pay when they book." /></p>
    {query.confirmed === "1" && <p className={styles.success} role="status"><WorkspaceText text="Payment successful. Booking Deposit has been added. Set your deposit below." /></p>}
    <BookingDepositPanel key={salonId} initial={state} salonId={salonId} settingsOnly />
  </main>;
}

export default withExperiencePage(BookingDepositSettingsPage);

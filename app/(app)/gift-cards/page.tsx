import { CustomerGiftCards } from "@/components/gift-card/customer-gift-cards";
import { withExperiencePage } from "@/components/experience-page";
export const metadata = { title: "Gift cards | Reylumi", referrer: "no-referrer" };
async function GiftCardsPage({ searchParams }: { searchParams: Promise<{ salon?:string }> }) {
  const { salon } = await searchParams; return <CustomerGiftCards salonId={salon}/>;
}
export default withExperiencePage(GiftCardsPage);

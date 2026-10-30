import { getCurrentBusinessContext, isOwnerMembership } from "@/lib/current-context";
import { redirect } from "next/navigation";
import { ManageGiftCards } from "@/components/gift-card/manage-gift-cards";
import { getCurrentSalonPosSettings } from "@/lib/pos-settings";
import { withExperiencePage } from "@/components/experience-page";
async function GiftCardsManagePage(){const ctx=await getCurrentBusinessContext();if(!ctx.user)redirect("/login");if(!ctx.currentSalon||!isOwnerMembership(ctx.currentMembership))redirect("/");const settings=await getCurrentSalonPosSettings(ctx);return <ManageGiftCards salonName={ctx.currentSalon.name} salonLogo={settings.salonLogoUrl??undefined}/>;}
export default withExperiencePage(GiftCardsManagePage);

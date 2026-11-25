import { withExperiencePage } from "@/components/experience-page";
import { CustomerDisplayClient } from "@/app/pos/customer-display/customer-display-client";
import { getCustomerDisplayServiceCatalog } from "@/app/pos/actions";
import { getPublicPosDisplaySettingsByToken } from "@/lib/pos-settings";
import { redirect } from "next/navigation";

type CustomerDisplayPageProps = { searchParams: Promise<{token?: string}> };

async function CustomerDisplayPage({searchParams}: CustomerDisplayPageProps) {
  const token = (await searchParams).token?.trim() ?? "";
  // Existing Windows opens an explicit draft token. Browser/iPad pairing always
  // uses its dedicated enrollment; Owner cookies never choose a counter.
  if (!token) redirect("/pos/portable/display");
  const [settings,serviceCatalog] = await Promise.all([
    getPublicPosDisplaySettingsByToken(token),
    getCustomerDisplayServiceCatalog(token),
  ]);
  return <main data-customer-display-shell className="h-dvh overflow-hidden bg-zinc-950 text-white">
    <CustomerDisplayClient serviceCatalog={serviceCatalog} settings={settings} token={token}/>
  </main>;
}
export default withExperiencePage(CustomerDisplayPage);

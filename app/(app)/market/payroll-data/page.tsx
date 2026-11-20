import Link from "next/link";
import {withOwnedSalonPage} from "@/components/owned-salon-page";
import {marketPluginContext,payrollDataPluginInstalled} from "@/lib/market-plugins";
import {marketTargetHref} from "@/lib/market-target-url";
import {DataDownloadPanel} from "@/app/payroll/data-download-panel";
import {PluginActivationPrompt} from "@/app/settings/plugin-settings-row";
async function PayrollDataPage(){
 const {salonId}=await marketPluginContext();
 const enabled=await payrollDataPluginInstalled();
 const end=new Date().toISOString().slice(0,10),start=end.slice(0,8)+"01";
 return <main className="mx-auto max-w-4xl space-y-4 p-4"><Link href={marketTargetHref("/market",salonId)}>← Market</Link>{enabled?<DataDownloadPanel salonId={salonId} startDate={start} endDate={end}/>:<PluginActivationPrompt pluginName="Payroll Data Download" salonId={salonId}/>}</main>;
}
export default withOwnedSalonPage(PayrollDataPage);

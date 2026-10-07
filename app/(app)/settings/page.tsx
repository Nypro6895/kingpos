import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { loadSettingsHub } from "@/app/settings/settings-hub-actions";
import { SettingsHubClient } from "@/app/settings/settings-hub-client";
export default async function SettingsPage({searchParams}: {searchParams:Promise<{section?:string;q?:string}>}) {
 const context=await getCurrentBusinessContext();
 if(!context.user)redirect("/login?next=/settings");
 const [index,params]=await Promise.all([loadSettingsHub(),searchParams]);
 return <SettingsHubClient user={context.user} createdAtLabel={new Date(context.user.created_at).toLocaleDateString("en-US")} index={index} initialSection={params.section} initialQuery={params.q}/>;
}

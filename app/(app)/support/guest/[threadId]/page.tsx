import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import Link from "next/link";
import {getGuestSupport} from "@/lib/guest-support";
import {SupportConversationPanel} from "@/app/support/support-ui";
async function GuestCasePage({params}:{params:Promise<{threadId:string}>}) {
 const {threadId}=await params;
 const c=await getGuestSupport(threadId).catch(()=>null);
 if(!c)return <main className="mx-auto max-w-3xl p-6"><h1 className="text-lg font-semibold"><WorkspaceText text="Request unavailable in this browser" /></h1><p className="my-3 text-sm"><WorkspaceText text="Use the browser where you sent this request, or contact support with your reference." /></p><Link href="/contact-support" className="underline"><WorkspaceText text="Contact support" /></Link></main>;
 return <main className="mx-auto max-w-3xl px-4 py-6"><Link className="mb-5 inline-block text-sm underline" href="/contact-support"><WorkspaceText text="Help & support" /></Link><SupportConversationPanel conversation={c} guestThreadId={threadId}/></main>;
}

export default withExperiencePage(GuestCasePage);

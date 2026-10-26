import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {supportRpc,type SupportConversation} from "@/lib/support-cases";
import {SupportConversationPanel} from "@/app/support/support-ui";
async function SupportCasePage({params}:{params:Promise<{caseId:string}>}) {
 const {caseId}=await params;if(!/^[a-f0-9-]{36}$/i.test(caseId))notFound();
 let conversation:SupportConversation|null;
 try{conversation=await supportRpc<SupportConversation>("get_support_conversation",{p_report_id:caseId});}catch{notFound();}
 if(!conversation)redirect("/login?next=/support");
 return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8"><Link href="/support" className="mb-5 inline-block text-sm text-orange-700"><WorkspaceText text="← Help & support" /></Link><SupportConversationPanel conversation={conversation} canReply={conversation.can_reply!==false}/></main>;
}

export default withExperiencePage(SupportCasePage);

import { WorkspaceText } from "@/components/workspace-language";
import Link from "next/link";
import { getSafetyContext } from "@/lib/abuse-context";
import { abuseServiceClient } from "@/lib/abuse-server";

export async function AbuseNotice({ userId }: { userId: string | null }) {
  let data: { mode?: string } | null = null;
  try {
    const context = await getSafetyContext();
    const result = await abuseServiceClient().rpc("get_abuse_notice", { p_user_id: userId, p_device: context.deviceHash, p_ip: context.ipHash || null, p_country: context.country || null });
    data = result.data;
  } catch { return null; }
    if (!data?.mode) return null;
    const message = data.mode === "warn" ? "Please review our community rules before posting." : data.mode === "review" ? "Your posts and comments require review before they appear publicly." : data.mode === "challenge" ? "Complete a security check before posting again." : "Posting and reporting are temporarily restricted.";
    return <aside role="status" className="relative z-50 border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-950"><WorkspaceText text={message} /> {data.mode === "challenge" ? <Link href="/security-check" className="font-medium underline"><WorkspaceText text="Security check" /></Link> : <Link href="/contact-support" className="font-medium underline"><WorkspaceText text="Contact support" /></Link>}</aside>;
}

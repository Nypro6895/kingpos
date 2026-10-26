import { AbuseNoticeView } from "@/components/abuse-notice-view";
import { getSafetyContext } from "@/lib/abuse-context";
import { abuseServiceClient } from "@/lib/abuse-server";

export async function getAbuseNoticeData(userId: string | null) {
  let data: { mode?: string } | null = null;
  try {
    const context = await getSafetyContext();
    const result = await abuseServiceClient().rpc("get_abuse_notice", { p_user_id: userId, p_device: context.deviceHash, p_ip: context.ipHash || null, p_country: context.country || null });
    data = result.data;
  } catch { return null; }
  return data?.mode ?? null;
}

export async function AbuseNotice({ userId }: { userId: string | null }) {
  return <AbuseNoticeView mode={await getAbuseNoticeData(userId)} />;
}

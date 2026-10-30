import { withExperiencePage } from "@/components/experience-page";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { RewardAdmin } from "@/components/rewardlumi/reward-admin";
async function Page() { await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.advertisingManage); return <RewardAdmin />; }

export default withExperiencePage(Page);

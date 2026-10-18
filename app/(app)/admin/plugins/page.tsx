import {withExperiencePage} from '@/components/experience-page';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/types/platform-admin';
import Link from 'next/link';
import {MarketSystemWorkspace} from '../market/system-workspace';
async function Page(){const actor=await requirePlatformAdmin(P.access);if(actor.roleSlug==='platform_owner')return <MarketSystemWorkspace section="plugins"/>;await requirePlatformAdmin(P.advertisingReview);return <><h1>Plugins</h1><Link href="/admin/plugins/campaigns">Campaigns →</Link></>;}
export default withExperiencePage(Page,{admin:true});

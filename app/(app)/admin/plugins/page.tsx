import {withExperiencePage} from '@/components/experience-page';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/types/platform-admin';
import Link from 'next/link';
import {MarketSystemWorkspace} from '../market/system-workspace';
import {AdminPageHeader} from '../_components/admin-ui';
async function Page(){const actor=await requirePlatformAdmin(P.access);if(actor.roleSlug==='platform_owner')return <MarketSystemWorkspace section="plugins"/>;await requirePlatformAdmin(P.advertisingReview);return <div className="market-system"><AdminPageHeader eyebrow="" title="Plugins"/><div className="plugin-directory"><div className="plugin-directory-head"><span>Plugin</span><span>Price</span><span>Status</span><span/></div><Link className="plugin-directory-row" href="/admin/plugins/campaigns"><span className="plugin-directory-name">Campaigns</span><span className="plugin-directory-price">120 credits = $1</span><span className="plugin-directory-status">Available</span><span aria-hidden="true">→</span></Link></div></div>;}
export default withExperiencePage(Page,{admin:true});

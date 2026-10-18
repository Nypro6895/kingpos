import {withExperiencePage} from '@/components/experience-page';
import {MarketSystemWorkspace} from '../market/system-workspace';
function Page(){return <MarketSystemWorkspace section="system"/>;}
export default withExperiencePage(Page,{admin:true});

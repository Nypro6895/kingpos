import {withExperiencePage} from '@/components/experience-page';
import {MarketSystemWorkspace} from '../../market/system-workspace';

async function Page({params}:{params:Promise<{pluginId:string}>}){
 const {pluginId}=await params;
 return <MarketSystemWorkspace section="plugins" pluginId={pluginId}/>;
}
export default withExperiencePage(Page,{admin:true});

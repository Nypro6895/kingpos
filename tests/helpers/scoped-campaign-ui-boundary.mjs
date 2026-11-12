// Existing browser suites keep their domain mocks; target binding is covered separately.
export function scopedCampaignUiBoundary(){return {name:'scoped-campaign-ui-boundary',setup(b){
 b.onResolve({filter:/scoped-market-client$/},()=>({path:'scoped-client',namespace:'scoped-campaign-fixture'}));
 b.onLoad({filter:/.*/,namespace:'scoped-campaign-fixture'},()=>({resolveDir:process.cwd(),contents:`import * as a from '@/app/campaigns/actions';import * as c from '@/app/campaigns/credit-actions';import * as v from '@/app/campaigns/creative-actions';const actions={...a,...c,...v,loadCampaignReportAction:async(...args)=>({days:await a.loadCampaignResultsAction(...args),deliveryReason:'active',checkedAt:new Date().toISOString(),lastViewAt:null,bookingOutcomes:{completed:0,cancelled:0,other:0,unavailable:0}})};export const useScopedMarketActions=()=>actions;export const useMarketTargetSalon=()=>undefined;export const MarketTargetProvider=({children})=>children;`}));
}};}

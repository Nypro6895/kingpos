export const campaignGroups={pending:['pending_review'],running:['running'],completed:['completed','cancelled'],issues:['awaiting_payment','paused','rejected']} as const;
export function adminCampaignFilters(params:Record<string,string|string[]|undefined>){
 const get=(k:string)=>typeof params[k]==='string'?params[k] as string:'';
 const group=Object.hasOwn(campaignGroups,get('status'))?get('status') as keyof typeof campaignGroups:'pending';
 const date=(value:string)=>{if(!value)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('Choose a valid date.');return value;};
 let from=date(get('from')),to=date(get('to'));const month=get('month');
 if(month&&(from||to))throw Error('Choose a month or a date range, not both.');
 if(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid month.');from=month+'-01';const end=new Date(from+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);to=end.toISOString().slice(0,10);}
 if(from&&to&&from>to)throw Error('End date must be after start date.');
 const endExclusive=to?new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString():'';
 return{group,states:campaignGroups[group],from,to,endExclusive,month,q:get('q').trim().slice(0,120).replace(/[^\p{L}\p{N}\s-]/gu,' ').trim(),page:Math.max(1,Math.min(10000,Math.floor(Number(get('page'))||1))),focus:/^[0-9a-f-]{36}$/i.test(get('campaign'))?get('campaign'):''};
}

"use client";
import{useEffect,useState}from"react";
import Link from"next/link";
import Image from"next/image";
import{CampaignWorkspace}from"@/app/campaigns/campaign-workspace";
import{CampaignActivation}from"@/app/campaigns/campaign-entry";
import{AppLocalMarketOrderView}from"@/components/app-local-market-order";
import{AppLocalDepositSettingsView}from"@/components/app-local-deposit-settings";
import styles from"@/components/owner-campaign.module.css";
import{useAppLocalResource}from"./app-local-resource";
import type{AppLocalPage,AppLocalPageProps}from"./app-local-page-registry";
import type{AppLocalCampaigns,AppLocalDepositSettings,AppLocalMarketOrder,AppLocalPublicCampaign}from"./app-local-commerce-metadata";
function PaymentOrder({resource}:{resource:ReturnType<typeof useAppLocalResource<AppLocalMarketOrder>>}){
 const[current,setCurrent]=useState(()=>navigator.onLine);
 useEffect(()=>{const changed=()=>setCurrent(navigator.onLine);window.addEventListener("online",changed);window.addEventListener("offline",changed);return()=>{window.removeEventListener("online",changed);window.removeEventListener("offline",changed);};},[]);
 // Bank instructions/remaining payment must be checked online; the view's
 // installed markup does not turn an old order into permission to pay.
 return current&&!resource.error&&resource.data?<AppLocalMarketOrderView {...resource.data}/>:<main className="p-6"><h1 className="text-2xl font-semibold">Payment order</h1><p className="mt-4">Connect to check this order before making a transfer.</p><button className="mt-4 rounded border px-4 py-2" onClick={()=>void resource.refresh()}>Check order</button></main>;
}
function CampaignDetail({data}:{data:AppLocalPublicCampaign}){
 const[expired,setExpired]=useState(()=>Date.parse(data.endsAt)<=Date.now());
 useEffect(()=>{const timer=setTimeout(()=>setExpired(true),Math.max(0,Math.min(Date.parse(data.endsAt)-Date.now(),2147483647)));return()=>clearTimeout(timer);},[data.endsAt]);
 if(expired)return <main className={styles.page}><Link href="/explore">Back to Explore</Link><h1>This campaign has ended.</h1></main>;
 return <main className={styles.page} style={{maxWidth:760}}><Link href="/explore">Back to Explore</Link><p className={styles.eyebrow}>SPONSORED</p><h1>{data.title}</h1>{data.imageUrl?<Image unoptimized src={data.imageUrl} alt={data.title} width={1200} height={900} style={{width:"100%",height:"auto",borderRadius:20}}/>:null}<p style={{whiteSpace:"pre-wrap",lineHeight:1.7}}>{data.caption}</p><div className={styles.actions}><Link className={styles.secondary} href={`/explore/salons/${data.salonId}`}>Visit business</Link><Link className={styles.primary} href={`/book/${data.salonId}`}>Book a visit</Link></div></main>;
}
function CommercePage({context,path,navigate}:AppLocalPageProps){
 const url=new URL(path,"https://reylumi.com"),campaign=url.pathname==="/campaigns",deposit=url.pathname==="/market/booking-deposit/settings",order=url.pathname.startsWith("/market/orders/"),name=campaign?"owner.campaigns":deposit?"owner.deposit-settings":order?"owner.market-order":"public.campaign",id=url.pathname.split("/").at(-1)!,args=order?{orderId:id}:!campaign&&!deposit?{campaignId:id}:{};
 const resource=useAppLocalResource<AppLocalCampaigns|AppLocalDepositSettings|AppLocalMarketOrder|AppLocalPublicCampaign>(context?.context.scope,name,args);
 const depositData=deposit?resource.data as AppLocalDepositSettings|undefined:undefined;
 useEffect(()=>{if(depositData&&(!depositData.paid||!depositData.state.installed))navigate("/market/booking-deposit");},[depositData,navigate]);
 const title=campaign?"Campaigns":deposit?"Booking Deposit":order?"Payment order":"Campaign";
 if(!resource.data)return <main className="p-6" aria-busy={resource.loading||resource.refreshing}><h1 className="text-2xl font-semibold">{title}</h1>{resource.error?<><p role="alert">{resource.error}</p><button className="mt-4 rounded border px-4 py-2" onClick={()=>void resource.refresh()}>Try again</button></>:<p role="status">Opening…</p>}</main>;
 if(campaign){const data=resource.data as AppLocalCampaigns;return data.wallet.installed?<CampaignWorkspace {...data} initialTab={url.searchParams.get("tab")==="settings"?"settings":"campaigns"} initialCreditView={url.searchParams.get("payment")==="attention"?"payment":url.searchParams.get("credits")==="needed"&&!data.wallet.auto_topup_enabled?"add":undefined}/>:<CampaignActivation/>;}
  if(depositData){if(!depositData.paid||!depositData.state.installed)return <main className="p-6" aria-busy="true"><h1>Booking Deposit</h1></main>;if(url.searchParams.has("salon")&&url.searchParams.get("salon")!==depositData.salonId)return <main className="p-6"><h1>Booking Deposit</h1><p role="alert">Select the salon used for this purchase, then try again.</p><Link href="/market/booking-deposit">Back to plugin</Link></main>;return <AppLocalDepositSettingsView {...depositData} query={{}}/>;}
 if(order)return <PaymentOrder resource={resource as ReturnType<typeof useAppLocalResource<AppLocalMarketOrder>>}/>;
 return <CampaignDetail data={resource.data as AppLocalPublicCampaign}/>;
}
export function getAppLocalCommercePage(path:string):AppLocalPage|null{
 try{
  if(!path.startsWith("/")||path.startsWith("//")||/[\\\u0000-\u001f]/.test(path))return null;
  const url=new URL(path,"https://reylumi.com");if(url.hash||url.searchParams.has("confirmed")||[...url.searchParams].some(([key,value])=>!["salon"].includes(key)||value.length>100))return null;
  if(url.pathname!=="/campaigns"&&url.pathname!=="/market/booking-deposit/settings"&&!/^\/(?:market\/orders|explore\/campaigns)\/[a-f0-9-]{36}$/i.test(url.pathname))return null;
  return{id:"commerce:"+url.pathname,title:url.pathname==="/campaigns"?"Campaigns":"Market",requiresContext:true,Component:CommercePage,features:["complete-original-controls","original-financial-confirmation","live-payment-order-only"]};
 }catch{return null;}
}

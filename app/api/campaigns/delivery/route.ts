import { isSameOriginMutation } from "@/lib/request-origin";
import { campaignSearchIntent } from "@/lib/campaign-search-intent";
import { resolveCampaignDeliveryArea } from "@/lib/campaign-delivery-area";
import { resolveExploreGpsArea } from "@/lib/location/explore-gps-area";
import { cookies } from "next/headers";
import { advertisingClient } from "@/lib/explore-advertising";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { campaignVisitorHash, campaignVisitorIdentity, readCampaignTicket, signCampaignTicket } from "@/lib/owner-campaign-delivery";
import { ownerCampaignSettings } from "@/lib/owner-campaigns";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type { OwnerCampaign } from "@/types/owner-campaign";
type OwnerTrace = {selectedAt:string;lastSeenAt:string|null;areaMatchedLevel:string;viewerAdsToday:number;viewerCampaignViewsToday:number;maxAdsPerDay:number;dailyFrequency:number;selectionRuleCodes:string[]};
import { AD_REPORT_COOKIE, createAdDisclosure, readAdRequestJson, safeAdDestination, selectionActor } from "@/lib/ad-reporting";
const COOKIE = "reylumi-owner-ad-visitor";
const noStore = { "Cache-Control": "private, no-store" };

async function selectCampaign(request: Request,input:{location?:string;latitude?:number|null;longitude?:number|null;batch?:boolean;query?:string}) {
  try {
    if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 160 || /[\x00-\x1f\x7f]/.test(input.query))) return Response.json(null,{status:400,headers:noStore});
    const [settings, context] = await Promise.all([ownerCampaignSettings(), getCurrentBusinessContext()]);
    if (!settings.enabled) return Response.json(null,{headers:noStore});
    const client = advertisingClient();
    const query = input.query?.trim() ?? "";
    const intent = query ? await campaignSearchIntent(query,input.location ?? "",async (name,args) => await client.rpc(name,args),request.signal) : undefined;
    if (query && !intent || request.signal.aborted) return Response.json(null,{headers:noStore});
    // Explore keeps an explicit selected area first, then a place from the query.
    // GPS may enrich that area only when it agrees with the chosen location.
    let locationResolution: "gps" | "lookup" | null = null;
    const area = await resolveCampaignDeliveryArea({...input,location:intent?.location || input.location},{
      lookup: async (field,value) => {
        const query=client.from("locations").select("city,state,postal_code,country").eq("status","active");
        const {data,error}=await (field==='postal_code'?query.eq(field,value):query.ilike(field,value.replace(/[%_]/g,""))).limit(1000);
        return error||!data?[]:data;
      },
      reverse:async point => (await resolveExploreGpsArea(point,request.signal)).area,
      onResolution: source => { locationResolution = source; },
    });
    if (!area || request.signal.aborted) return Response.json(null,{headers:noStore});
    const jar = await cookies();
    let visitor = jar.get(COOKIE)?.value;
    if (!visitor || !/^[0-9a-f-]{36}$/i.test(visitor)) { visitor = crypto.randomUUID(); jar.set(COOKIE,visitor,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:86400*365}); }
    const visitorIdentity = campaignVisitorIdentity(request.headers,visitor,context.user?.id ?? null);
    const historyScope = context.user ? "account" : visitorIdentity.startsWith("network:") ? "shared_network" : "browser";
    const visitorHash = campaignVisitorHash(visitorIdentity);
    const { data: selections, error } = await client.rpc("select_owner_ad_disclosures", { p_area:area,p_visitor:visitorHash,p_viewer:context.user?.id ?? null,p_terms:intent?.terms ?? null,p_kind:intent?.kind ?? null,p_category:intent?.category ?? null });
    const data = selections?.map((row: {campaign: OwnerCampaign;trace: OwnerTrace}) => ({...row.campaign, disclosureTrace:row.trace}));
    if (error || !data?.length) return Response.json(null,{headers:noStore});
    // Public business identity helps a customer recognize who is advertising.
    // Resolve the batch once; never invent ratings, offers or appointment times.
    const { data: salons } = await client.from("locations").select("id,name,city,state").in("id", [...new Set(data.map((candidate: (typeof data)[number]) => candidate.salon_id))]);
    const businesses = new Map((salons ?? []).map(salon => [salon.id, salon]));
    const reporting = selectionActor("owner_campaign", context.user?.id ?? null, jar.get(AD_REPORT_COOKIE.owner_campaign)?.value);
    if (reporting.guestId) jar.set(reporting.cookieName, reporting.guestId, {httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/"});
    const materialize = async (candidate: (typeof data)[number]) => {
      const { data: post } = await client.rpc("owner_campaign_post", {p_type:candidate.source_type,p_source:candidate.source_id,p_salon:candidate.salon_id});
      if (!post) return null;
      const href = candidate.source_type === "custom" ? `/explore/campaigns/${candidate.id}` : candidate.source_type === "salon_profile_look" ? `/explore/looks/${candidate.source_id}` : candidate.source_type === "beauty_post" ? `/explore/beauty/${post.profile_id}/posts/${candidate.source_id}` : `/explore/salons/${candidate.salon_id}#update-${candidate.source_id}`;
      let mediaPath = post.media_path as string | null;
      let image = getSalonProfileMediaUrl(post.media_path);
      if (candidate.source_type === "custom") {
        const {data:asset}=await client.storage.from("campaign-creatives").createSignedUrl(post.media_path.endsWith("/v1/main.webp") ? post.media_path.replace(/main\.webp$/, "w960.webp") : post.media_path,3600);
        if (!asset?.signedUrl) return null;
        image=asset.signedUrl;
      }
      if (candidate.source_type === "beauty_post") {
        const {data:media} = await client.from("beauty_post_media").select("object_path").eq("post_id",candidate.source_id).neq("role","before").order("display_order").limit(1).maybeSingle();
        if (!media?.object_path) return null;
        mediaPath = media.object_path;
        image = client.storage.from("beauty-profile-media").getPublicUrl(media.object_path).data.publicUrl;
      }
      if (candidate.source_type === "salon_profile_look" && !image) return null;
      const ticket = signCampaignTicket({id:candidate.id,visitor:visitorHash,viewer:context.user?.id ?? null,area,expires:Date.now()+600000,nonce:crypto.randomUUID()});
      const business = businesses.get(candidate.salon_id);
      const trace = candidate.disclosureTrace;
      if (!trace || !Array.isArray(trace.selectionRuleCodes)) return null;
      const selectedAt = new Date(trace.selectedAt).toISOString();
      const advertiserName = String(business?.name || "Salon promotion").slice(0,200);
      const areaLabel = [area.neighborhood,area.zipcode,area.city,area.state,area.country].filter(Boolean).join(", ").slice(0,200);
      const gpsUsed = locationResolution === "gps";
      const details = [
        {label:"Selected at",value:selectedAt},
        {label:"Your selected area",value:input.location || "Device location"},
        {label:"Area used to match this ad",value:areaLabel},
        {label:"Advertiser area",value:[candidate.area,candidate.location,candidate.city,candidate.state,candidate.country].filter(Boolean).join(", ")},
        {label:"Location matching",value:gpsUsed ? "Your precise device location was used to resolve the matching area." : "Your selected area was matched to public location records. Precise device coordinates were not used to resolve this match."},
        ...(gpsUsed ? [{label:"Your precise coordinates used",value:String(input.latitude)+", "+String(input.longitude)}] : []),
        ...(intent ? [{label:"Your search",value:query},{label:"Search matching",value:"Type: "+intent.kind+"; terms: "+(intent.terms || "none")+"; service category: "+(intent.category || "none")},{label:"Search area",value:intent.location || "Your selected area"}] : [{label:"Search",value:"This ad was selected from your area without a search relevance rule."}]),
        {label:"Ad schedule",value:candidate.starts_at+" to "+candidate.ends_at},
        {label:"Display history scope",value:historyScope === "shared_network" ? "Shared network" : historyScope === "account" ? "Your account" : "This browser"},
        {label:"Display history used",value:historyScope === "account" ? "Your account last viewed this ad: "+(trace.lastSeenAt || "none")+". Today: "+trace.viewerAdsToday+" ads; "+trace.viewerCampaignViewsToday+" views of this ad (America/Chicago)." : "Rotation and frequency rules use "+historyScope+"-associated advertising history. This identifier may be shared; another person’s viewing counts and timestamps are not shown."},
        {label:"Your viewing limits",value:"Up to "+trace.maxAdsPerDay+" ads and "+trace.dailyFrequency+" views of this ad per "+historyScope+" today (America/Chicago)."},
        {label:"Rotation and availability",value:"One eligible ad per salon, least recently viewed first; ties use start time, creation time, then ad ID. Only approved, available ads from active advertisers within their schedule and daily pacing qualify. Your own salon's ads are excluded when signed in."},
      ];
      const adDisclosure = createAdDisclosure({version:1,selectionId:crypto.randomUUID(),issuedAt:Date.now(),expiresAt:Date.now()+600000,
        target:{kind:"owner_campaign",campaignId:candidate.id,sourceType:candidate.source_type,sourceId:candidate.source_id,salonId:candidate.salon_id},
        snapshot:{advertiserName,title:String(candidate.title ?? "").slice(0,200),caption:String(post.caption ?? post.summary ?? "").slice(0,5000),mediaBucket:mediaPath ? candidate.source_type === "custom" ? "campaign-creatives" : candidate.source_type === "beauty_post" ? "beauty-profile-media" : "salon-profile-media" : null,mediaPath:mediaPath || null,destinationPath:safeAdDestination(href),selectedAt},
        summary:{locationSource:gpsUsed ? "gps" : intent?.location ? "search" : "manual",areaLabel,searchKind:intent && ["service","style","name"].includes(intent.kind) ? intent.kind as "service"|"style"|"name" : null,searchCategory:intent?.category?.slice(0,80) || null,page:"/explore",device:null,audience:null,selectionRuleCodes:trace.selectionRuleCodes,selectedAt},
        disclosure:{advertiserName,primaryReasons:[query ? "Your search helped match this salon promotion." : "This salon advertises in your selected area.",gpsUsed ? "Your precise device location helped resolve the matching area." : "Your viewing history and the ad's availability determined its place in the rotation."],details},
      },reporting.actor);
      return { adDisclosure,title:candidate.title,caption:post.caption ?? post.summary ?? "",image,href,ticket,
        salonName:business?.name ?? null,salonLocation:[business?.city,business?.state].filter(Boolean).join(", ") };
    };
    const ads = [];
    if (input.batch) {
      const results = await Promise.all(data.map(materialize));
      ads.push(...results.filter((ad): ad is NonNullable<typeof ad> => ad !== null).slice(0,5));
    } else {
      for (const candidate of data) {
        const ad = await materialize(candidate);
        if (ad) { ads.push(ad); break; }
      }
    }
    return Response.json(input.batch ? ads : ads[0] ?? null,{headers:noStore});
  } catch { return Response.json(null,{headers:noStore}); }
}
export async function GET(request: Request) {
  return selectCampaign(request,{location:new URL(request.url).searchParams.get("location")??"",query:new URL(request.url).searchParams.get("query")??undefined,batch:new URL(request.url).searchParams.get("batch")==="1"});
}
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ok:false},{status:403,headers:noStore});
  try {
    const body = await readAdRequestJson(request,8192) as Record<string, unknown>;
    if (body?.kind === "select") {
      const hasGps = body.latitude !== undefined || body.longitude !== undefined;
      if (typeof body.location !== "string" || body.location.length>160 || hasGps && (typeof body.latitude !== "number" || typeof body.longitude !== "number" || !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || Math.abs(body.latitude)>90 || Math.abs(body.longitude)>180)) return Response.json(null,{status:400,headers:noStore});
      return selectCampaign(request,{location:body.location,latitude:body.latitude as number|undefined,longitude:body.longitude as number|undefined,batch:body.batch===true,query:body.query as string|undefined});
    }
    if (typeof body.ticket !== "string" || !["view","click"].includes(String(body.kind))) return Response.json({ok:false},{status:400});
    const ticket = readCampaignTicket(body.ticket);
    const visitor = (await cookies()).get(COOKIE)?.value;
    if (!ticket || !visitor) return Response.json({ok:false},{status:403});
    const context = await getCurrentBusinessContext();
    if (ticket.visitor !== campaignVisitorHash(campaignVisitorIdentity(request.headers,visitor,context.user?.id ?? null))) return Response.json({ok:false},{status:403});
    if (ticket.viewer !== (context.user?.id ?? null)) return Response.json({ok:false},{status:403});
    const { data, error } = await advertisingClient().rpc(body.kind === "click" ? "owner_campaign_click" : "owner_campaign_admit", {p_id:ticket.id,p_visitor:ticket.visitor,...(body.kind === "view" ? {p_kind:"view"} : {}),p_area:ticket.area,p_viewer:ticket.viewer,p_nonce:ticket.nonce});
    return Response.json({ok:!error && data===true},{headers:noStore});
  } catch { return Response.json({ok:false},{status:400,headers:noStore}); }
}

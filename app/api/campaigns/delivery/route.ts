import { resolveCampaignDeliveryArea } from "@/lib/campaign-delivery-area";
import { resolveExploreGpsArea } from "@/lib/location/explore-gps-area";
import { cookies } from "next/headers";
import { advertisingClient } from "@/lib/explore-advertising";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { campaignVisitorHash, campaignVisitorIdentity, readCampaignTicket, signCampaignTicket } from "@/lib/owner-campaign-delivery";
import { ownerCampaignSettings } from "@/lib/owner-campaigns";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
const COOKIE = "reylumi-owner-ad-visitor";
const noStore = { "Cache-Control": "private, no-store" };

async function selectCampaign(request: Request,input:{location?:string;latitude?:number|null;longitude?:number|null}) {
  try {
    const [settings, context] = await Promise.all([ownerCampaignSettings(), getCurrentBusinessContext()]);
    if (!settings.enabled) return Response.json(null,{headers:noStore});
    const client = advertisingClient();
    const area = await resolveCampaignDeliveryArea(input,{
      lookup: async (field,value) => {
        const query=client.from("locations").select("city,state,postal_code,country").eq("status","active");
        const {data,error}=await (field==='postal_code'?query.eq(field,value):query.ilike(field,value.replace(/[%_]/g,""))).limit(1000);
        return error||!data?[]:data;
      },
      reverse:async point => (await resolveExploreGpsArea(point,request.signal)).area,
    });
    if (!area || request.signal.aborted) return Response.json(null,{headers:noStore});
    const jar = await cookies();
    let visitor = jar.get(COOKIE)?.value;
    if (!visitor || !/^[0-9a-f-]{36}$/i.test(visitor)) { visitor = crypto.randomUUID(); jar.set(COOKIE,visitor,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:86400*365}); }
    const visitorHash = campaignVisitorHash(campaignVisitorIdentity(request.headers,visitor,context.user?.id ?? null));
    const { data, error } = await client.rpc("owner_campaign_candidates", { p_area:area,p_visitor:visitorHash,p_viewer:context.user?.id ?? null });
    if (error || !data?.length) return Response.json(null,{headers:noStore});
    for (const candidate of data) {
      const { data: post } = await client.rpc("owner_campaign_post", {p_type:candidate.source_type,p_source:candidate.source_id,p_salon:candidate.salon_id});
      if (!post) continue;
      const href = candidate.source_type === "custom" ? `/explore/campaigns/${candidate.id}` : candidate.source_type === "salon_profile_look" ? `/explore/looks/${candidate.source_id}` : candidate.source_type === "beauty_post" ? `/explore/beauty/${post.profile_id}/posts/${candidate.source_id}` : `/explore/salons/${candidate.salon_id}#update-${candidate.source_id}`;
      let image = getSalonProfileMediaUrl(post.media_path);
      if (candidate.source_type === "custom") {
        const {data:asset}=await client.storage.from("campaign-creatives").createSignedUrl(post.media_path.endsWith("/v1/main.webp") ? post.media_path.replace(/main\.webp$/, "w960.webp") : post.media_path,3600);
        if (!asset?.signedUrl) continue;
        image=asset.signedUrl;
      }
      if (candidate.source_type === "beauty_post") {
        const {data:media} = await client.from("beauty_post_media").select("object_path").eq("post_id",candidate.source_id).neq("role","before").order("display_order").limit(1).maybeSingle();
        if (!media?.object_path) continue;
        image = client.storage.from("beauty-profile-media").getPublicUrl(media.object_path).data.publicUrl;
      }
      if (candidate.source_type === "salon_profile_look" && !image) continue;
      const ticket = signCampaignTicket({id:candidate.id,visitor:visitorHash,viewer:context.user?.id ?? null,area,expires:Date.now()+600000,nonce:crypto.randomUUID()});
      return Response.json({ title:candidate.title,caption:post.caption ?? post.summary ?? "",image,href,ticket },{headers:noStore});
    }
    return Response.json(null,{headers:noStore});
  } catch { return Response.json(null,{headers:noStore}); }
}
export async function GET(request: Request) {
  return selectCampaign(request,{location:new URL(request.url).searchParams.get("location")??""});
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ok:false},{status:403,headers:noStore});
  try {
    if (Number(request.headers.get("content-length"))>8192) return Response.json({ok:false},{status:413});
    const raw = await request.text();
    if (raw.length > 8192) return Response.json({ok:false},{status:413,headers:noStore});
    const body = JSON.parse(raw);
    if (body?.kind === "select") {
      if (typeof body.location !== "string" || typeof body.latitude !== "number" || typeof body.longitude !== "number" || !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || Math.abs(body.latitude)>90 || Math.abs(body.longitude)>180) return Response.json(null,{status:400,headers:noStore});
      return selectCampaign(request,{location:body.location,latitude:body.latitude,longitude:body.longitude});
    }
    if (typeof body.ticket !== "string" || !["view","click"].includes(body.kind)) return Response.json({ok:false},{status:400});
    const ticket = readCampaignTicket(body.ticket);
    const visitor = (await cookies()).get(COOKIE)?.value;
    if (!ticket || !visitor) return Response.json({ok:false},{status:403});
    const context = await getCurrentBusinessContext();
    if (ticket.visitor !== campaignVisitorHash(campaignVisitorIdentity(request.headers,visitor,context.user?.id ?? null))) return Response.json({ok:false},{status:403});
    if (ticket.viewer !== (context.user?.id ?? null)) return Response.json({ok:false},{status:403});
    const { data, error } = await advertisingClient().rpc("owner_campaign_admit", {p_id:ticket.id,p_visitor:ticket.visitor,p_kind:body.kind,p_area:ticket.area,p_viewer:ticket.viewer,p_nonce:ticket.nonce});
    return Response.json({ok:!error && data===true},{headers:noStore});
  } catch { return Response.json({ok:false},{status:400,headers:noStore}); }
}

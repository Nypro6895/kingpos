import { cookies } from "next/headers";
import { advertisingClient } from "@/lib/explore-advertising";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { campaignVisitorHash, campaignVisitorIdentity, readCampaignTicket, signCampaignTicket } from "@/lib/owner-campaign-delivery";
import { ownerCampaignSettings } from "@/lib/owner-campaigns";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
const COOKIE = "reylumi-owner-ad-visitor";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const [settings, context] = await Promise.all([ownerCampaignSettings(), getCurrentBusinessContext()]);
    if (!settings.enabled) return Response.json(null,{headers:noStore});
    const params = new URL(request.url).searchParams;
    const location = (params.get("location") ?? "").trim();
    if (!location || location.length > 160) return Response.json(null,{headers:noStore});
    const client = advertisingClient();
    // Match a user-selected place to a known place. Ambiguous or unknown places never broaden targeting.
    const parts = location.split(",").map(part => part.trim());
    const query = client.from("locations").select("city,state,postal_code,country").eq("status","active");
    const neighborhood = parts.length === 4 ? parts[0] : "";
    const cityInput = neighborhood ? parts[1] : parts[0];
    const stateInput = neighborhood ? parts[2] : parts[1];
    const countryInput = neighborhood ? parts[3] : parts[2];
    const postal = !neighborhood && /^[a-z0-9 -]{3,12}$/i.test(cityInput) && /\d/.test(cityInput);
    const { data: places, error: placeError } = await (postal ? query.eq("postal_code",cityInput) : query.ilike("city",cityInput.replace(/[%_]/g,""))).limit(100);
    if (placeError) return Response.json(null,{headers:noStore});
    let level: "city" | "state" | "country" = "city";
    let eligible = (places ?? []).filter(place => (!stateInput || place.state?.toLowerCase() === stateInput.toLowerCase()) && (!countryInput || place.country?.toLowerCase() === countryInput.toLowerCase()));
    if (!eligible.length && !postal && !neighborhood && parts.length <= 2) {
      const { data: states, error } = await client.from("locations").select("city,state,postal_code,country").eq("status","active").ilike("state",cityInput.replace(/[%_]/g,"")).limit(100);
      if (error) return Response.json(null,{headers:noStore});
      eligible = (states ?? []).filter(place => !parts[1] || place.country?.toLowerCase() === parts[1].toLowerCase()); level = "state";
      if (!eligible.length && parts.length === 1) {
        const {data:countries,error} = await client.from("locations").select("city,state,postal_code,country").eq("status","active").ilike("country",cityInput.replace(/[%_]/g,"")).limit(100);
        if (error) return Response.json(null,{headers:noStore});
        eligible = countries ?? []; level = "country";
      }
    }
    const unique = new Map(eligible.map(place => [level === "country" ? place.country : level === "state" ? `${place.state}:${place.country}` : `${place.city}:${place.state}:${place.country}`,place]));
    if (unique.size !== 1) return Response.json(null,{headers:noStore});
    const place = [...unique.values()][0];
    const area = { country:place.country ?? "",state:level === "country" ? "" : place.state ?? "",city:level === "city" ? place.city ?? "" : "",zipcode:postal ? cityInput : "",neighborhood };
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
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ok:false},{status:403,headers:noStore});
  try {
    if (Number(request.headers.get("content-length"))>8192) return Response.json({ok:false},{status:413});
    const raw = await request.text();
    if (raw.length > 8192) return Response.json({ok:false},{status:413,headers:noStore});
    const body = JSON.parse(raw);
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

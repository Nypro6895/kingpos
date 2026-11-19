import {
  signAdAttribution,
  AD_ATTRIBUTION_COOKIE,
} from "@/lib/advertising-attribution";
import {
  getCampaigns,
  advertisingClient,
  getAdvertisingLimits,
} from "@/lib/explore-advertising";
import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { campaignActive, campaignMatches } from "@/lib/explore-advertising-rules";
import type { CampaignAudience } from "@/types/explore-advertising";
import { AD_REPORT_COOKIE, createAdDisclosure, readAdRequestJson, reportActor, safeAdDestination, selectionActor, withAdAdmissionTrace } from "@/lib/ad-reporting";
import { readAdDisclosureProof } from "@/lib/ad-disclosure-ticket";
async function targeting(
  request: NextRequest,
  body?: { path?: string; device?: string },
) {
  const context = await getRequestBusinessContext();
  const audience: CampaignAudience = !context.user
    ? "guest"
    : context.workspaceType === "salon"
      ? context.salonMode === "staff"
        ? "staff"
        : "owner"
      : "personal";
  const path =
    body?.path ?? request.nextUrl.searchParams.get("path") ?? "/explore";
  const device =
    (body?.device ?? request.nextUrl.searchParams.get("device")) === "desktop"
      ? "desktop"
      : "mobile";
  return { audience, path, device, userId: context.user?.id ?? null } as const;
}
function visitorHash(request: NextRequest) {
  const configured = process.env.VERCEL
    ? "x-vercel-forwarded-for"
    : (process.env.ADVERTISING_TRUSTED_IP_HEADER ?? "x-forwarded-for");
  const ip = [
    "cf-connecting-ip",
    "x-vercel-forwarded-for",
    "x-forwarded-for",
  ].includes(configured)
    ? request.headers.get(configured)?.split(",")[0]?.trim()
    : null;
  // Production must use IP headers provided and overwritten by the trusted hosting proxy.
  const identity =
    ip ??
    request.cookies.get("reylumi-ad-visitor")?.value ??
    crypto.randomUUID();
  const secret =
    process.env.ADVERTISING_IP_HASH_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Advertising is unavailable.");
  return {
    hash: createHmac("sha256", secret).update(identity).digest("hex"),
    identity,
    ip,
  };
}
export async function GET(request: NextRequest) {
  try {
    const [limits, target, allCampaigns] = await Promise.all([getAdvertisingLimits(), targeting(request), getCampaigns(false)]);
    const selectionTime = Date.now();
    const selectedAt = new Date(selectionTime).toISOString();
    const campaigns = target.path.startsWith("/admin")
      ? []
      : allCampaigns.filter((c) =>
          campaignActive(c, selectionTime) && campaignMatches(c, target.path, target.audience, target.device),
        );
    const visitor = visitorHash(request);
    const ids = campaigns
      .filter((c) => c.kind === "popup" && c.repeat !== "always")
      .map((c) => c.id);
    const { data, error } = ids.length
      ? await advertisingClient()
          .from("explore_campaign_impressions")
          .select("campaign_id,last_seen")
          .eq("visitor_hash", visitor.hash)
          .in("campaign_id", ids)
      : { data: [], error: null };
    if (error) throw error;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
    }).format(new Date());
    const allowed = campaigns.filter((c) => {
      const seen = data?.find((row) => row.campaign_id === c.id);
      return (
        !seen ||
        c.repeat === "always" ||
        (c.repeat === "daily" &&
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Chicago",
          }).format(new Date(seen.last_seen)) !== today)
      );
    });
    const reporting = selectionActor("platform_campaign", target.userId, request.cookies.get(AD_REPORT_COOKIE.platform_campaign)?.value);
    const disclosed = allowed.map(c => {
      const primaryReasons: [string,string] = ["This promotion is available on the page you are viewing.","It matches your account view and screen layout."];
      const details = [
        {label:"Selected at",value:selectedAt},
        {label:"Page used",value:target.path},
        {label:"Your account view",value:target.audience},
        {label:"Your screen layout",value:target.device},
        {label:"Allowed pages",value:(c.locations ?? ["/explore"]).join(", ")},
        {label:"Allowed account views",value:(c.audiences ?? ["guest","personal","staff","owner"]).join(", ")},
        {label:"Allowed screen layouts",value:(c.devices ?? ["desktop","mobile"]).join(", ")},
        {label:"Schedule",value:(c.startsAt || "No start restriction")+" to "+(c.endsAt || "No end restriction")},
        {label:"Popup viewing history",value:c.kind === "popup" && c.repeat !== "always" ? "Repeat rule: "+c.repeat+". Eligibility uses "+(visitor.ip ? "shared-network" : "browser-associated")+" prior display history; another person’s viewing timestamps are not shown. Daily rules use America/Chicago." : "This promotion does not use a popup history exclusion."},
        {label:"Display eligibility",value:"The promotion is enabled, within its schedule and matches the page, account view and screen layout shown above. Admin pages do not show ads."},
        {label:"Display session rules",value:"Up to "+limits.maxTotal+" promotions and "+limits.maxPopups+" popups per display session; at least "+limits.minPopupGapSeconds+" seconds between popups. The session cookie lasts "+limits.sessionMinutes+" minutes from its most recent update. Already viewed promotions cannot be shown again in the same session. These limits and current display history are checked again before a promotion appears."},
        {label:"Placements",value:c.kind === "placement" ? (c.placements ?? ["sidebar","feed"]).join(", ") : c.kind},
      ];
      const adDisclosure = createAdDisclosure({version:1,selectionId:crypto.randomUUID(),issuedAt:selectionTime,expiresAt:selectionTime+600000,
        target:{kind:"platform_campaign",campaignId:c.id,sourceType:"explore_campaign",sourceId:c.id,salonId:null},
        snapshot:{advertiserName:c.name.slice(0,200),title:c.name.slice(0,200),caption:c.text.slice(0,5000),mediaBucket:null,mediaPath:null,destinationPath:safeAdDestination(c.href),selectedAt},
        summary:{locationSource:"none",areaLabel:null,searchKind:null,searchCategory:null,page:"/"+(target.path.split("/")[1] || ""),device:target.device,audience:target.audience,selectionRuleCodes:["enabled_schedule","page_match","audience_match","device_match",...(c.kind === "popup" && c.repeat !== "always" ? ["popup_history"] : [])],selectedAt},
        disclosure:{advertiserName:c.name.slice(0,200),primaryReasons,details},
      },reporting.actor);
      return {...c,adDisclosure};
    });
    const response = NextResponse.json(
      { campaigns: disclosed, limits },
      { headers: { "Cache-Control": "private, no-store", "Referrer-Policy":"no-referrer" } },
    );
    if (reporting.guestId) response.cookies.set(reporting.cookieName,reporting.guestId,{httpOnly:true,sameSite:"lax",secure:request.nextUrl.protocol === "https:",path:"/"});
    const sessionCookie = request.cookies.get("reylumi-ad-session")?.value;
    const session = /^[0-9a-f-]{36}$/i.test(sessionCookie ?? "")
      ? sessionCookie!
      : crypto.randomUUID();
    response.cookies.set("reylumi-ad-session", session, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: limits.sessionMinutes * 60,
    });
    if (!visitor.ip)
      response.cookies.set("reylumi-ad-visitor", visitor.identity, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 31536000,
      });
    return response;
  } catch {
    return NextResponse.json(
      { campaigns: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ allowed: false }, { status: 403 });
  try {
    const body = await readAdRequestJson(request) as {id?:unknown;path?:string;device?:string;event?:string;phase?:string;reservation?:unknown;disclosureProof?:unknown};
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
      return NextResponse.json({ allowed: false }, { status: 400 });
    const visitor = visitorHash(request);
    const [target, allCampaigns, limits] = await Promise.all([targeting(request, body), getCampaigns(body.event !== "click"), getAdvertisingLimits()]);
    const campaign = allCampaigns.find(
      (c) => c.id === body.id,
    );
    if (
      !campaign ||
      target.path.startsWith("/admin") ||
      !campaignMatches(campaign, target.path, target.audience, target.device)
    )
      return NextResponse.json({ allowed: false }, { status: 403 });
    {
      if (!["view", "click"].includes(String(body.event)))
        return NextResponse.json({ allowed: false }, { status: 400 });
      const session = request.cookies.get("reylumi-ad-session")?.value;
      if (!session || !/^[0-9a-f-]{36}$/i.test(session))
        return NextResponse.json({ allowed: false }, { status: 400 });
      const client = advertisingClient();
      if (body.event === "view" && body.phase === "reserve") {
        if (body.disclosureProof !== undefined) {
          if (typeof body.disclosureProof !== "string") throw new Error("Display proof unavailable.");
          const actor = reportActor(target.userId,request.cookies.get(AD_REPORT_COOKIE.platform_campaign)?.value);
          if (!actor) throw new Error("Display proof unavailable.");
          const selection = readAdDisclosureProof(body.disclosureProof,"platform_campaign",actor,{allowExpired:true});
          if (selection.target.campaignId !== body.id || selection.summary.audience !== target.audience || selection.summary.device !== target.device || selection.disclosure.details.find(detail=>detail.label==="Page used")?.value !== target.path) throw new Error("Display proof scope changed.");
          const result = await client.rpc("reserve_advertising_display_disclosed",{p_campaign:body.id,p_session:session,p_visitor:visitor.hash,p_device:target.device,p_audience:target.audience,p_path:"/"+(target.path.split("/")[1] ?? "")});
          if(result.error) throw new Error("Display trace unavailable.");
          const row=result.data as {reservation?:string|null;trace?:unknown}|null;
          if(!row?.reservation) return NextResponse.json({allowed:false},{headers:{"Cache-Control":"private, no-store"}});
          const admissionDisclosure=createAdDisclosure(withAdAdmissionTrace(selection,row.trace),actor);
          return NextResponse.json({allowed:true,reservation:row.reservation,admissionDisclosure},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
        }
        const { data, error } = await client.rpc("reserve_advertising_display", {
          p_campaign: body.id, p_session: session, p_visitor: visitor.hash,
          p_device: target.device, p_audience: target.audience,
          p_path: "/" + (target.path.split("/")[1] ?? ""),
        });
        if (error) throw error;
        return NextResponse.json({ allowed: Boolean(data), reservation: data ?? null }, { headers: { "Cache-Control": "no-store" } });
      }
      const hasReservation = typeof body.reservation === "string" && /^[0-9a-f-]{36}$/i.test(body.reservation);
      let confirmed = false;
      if (hasReservation) {
        const result = await client.rpc("confirm_advertising_display", { p_token: body.reservation, p_session: session, p_visitor: visitor.hash, p_campaign: body.id });
        if (result.error) throw result.error;
        confirmed = result.data === true;
        if (!confirmed) return NextResponse.json({ allowed: false });
      }
      if (body.phase === "confirm" && !hasReservation) return NextResponse.json({ allowed: false }, { status: 400 });
      // Legacy clients retain the atomic claim. New clients reserve, paint, then confirm.
      const { data, error } = body.event === "view" && confirmed
        ? { data: true, error: null }
        : await client.rpc(
        "record_advertising_event",
        {
          p_campaign: body.id, p_session: session, p_kind: body.event,
          p_device: target.device, p_audience: target.audience,
          p_path: "/" + (target.path.split("/")[1] ?? ""), p_visitor: visitor.hash,
        },
      );
      if (error) throw error;
      const response = NextResponse.json(
        { allowed: data === true },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set("reylumi-ad-session", session, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: limits.sessionMinutes * 60,
      });
      if (data === true && body.event === "click")
        response.cookies.set(
          AD_ATTRIBUTION_COOKIE,
          signAdAttribution({
            id: body.id,
            session,
            device: target.device,
            audience: target.audience,
            path: "/" + (target.path.split("/")[1] ?? ""),
            at: Date.now(),
          }),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: request.nextUrl.protocol === "https:",
            path: "/",
            maxAge: 7 * 86400,
          },
        );
      return response;
    }
  } catch {
    return NextResponse.json({ allowed: false }, { status: 503 });
  }
}

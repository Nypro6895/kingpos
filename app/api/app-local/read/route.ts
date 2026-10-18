import { connection } from "next/server";
import { headers } from "next/headers";
import { readAppLocalOwnerResource } from "@/lib/app-local-owner-resources-server";
import { readAppLocalRoleResource } from "@/lib/app-local-role-resources-server";
import { readAppLocalPlatformResource } from "@/lib/app-local-platform-resources-server";
import { readAppLocalHttpResource } from "@/lib/app-local-http-server";
import { readAppLocalRoleHttpResource } from "@/lib/app-local-role-http-server";
import { readAppLocalPersonalResource } from "@/lib/app-local-personal-resources-server";
import { readAppLocalStaffRelayResource } from "@/lib/app-local-staff-relay-server";
import { readAppLocalExploreResource } from "@/lib/app-local-explore-server";
import { readAppLocalOwnerPageResource } from "@/lib/app-local-owner-page-registry-server";
import { readAppLocalBusinessResource } from "@/lib/app-local-business-server";
import { readAppLocalPublicResource } from "@/lib/app-local-public-server";
import { readAppLocalDailyResource } from "@/lib/app-local-daily-server";
import { readAppLocalBusinessHttpResource } from "@/lib/app-local-business-http-server";
import { readAppLocalSecondaryResource } from "@/lib/app-local-secondary-server";
import { readAppLocalPayrollTaxResource } from "@/lib/app-local-payroll-tax-server";
import { readAppLocalCommerceResource } from "@/lib/app-local-commerce-server";
import { readAppLocalShellResource } from "@/lib/app-local-shell-server";
import { readAppLocalPortableResource } from "@/lib/app-local-portable-server";
import { readAppLocalPortableHttpResource } from "@/lib/app-local-portable-http-server";
import { isAppLocalScopeId } from "@/lib/app-local-scope-id";
import { runWithReadContext } from "@/lib/read-context-scope";
import { readAppLocalDisplayResource } from "@/lib/app-local-display-server";
import { createReadRequestTiming } from "@/lib/read-request-timing";

async function readPage(request: Request) {
  await connection();
  const timing = createReadRequestTiming();
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie, If-None-Match" };
  const json = (data: unknown, init: ResponseInit) => timing.finish(timing.measureSync("serialize", () => Response.json(data, init)));
  if ((await timing.measure("auth", () => headers())).get("x-reylumi-auth-unavailable") === "1") return json({ error: "Please reconnect and try again" }, { status: 503, headers: responseHeaders });
  try {
    let name: string, scope: string, args: unknown;
    if (request.method === "POST") {
      if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return json({ error:"Invalid page origin" }, {status:403,headers:responseHeaders});
      if (Number(request.headers.get("content-length")??0)>131072) return json({error:"Page filters are too large"},{status:413,headers:responseHeaders});
      const reader=request.body?.getReader();if(!reader)throw new SyntaxError("Missing read filters");
      let length=0;const chunks:Uint8Array[]=[];
      for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>131072){await reader.cancel();return json({error:"Page filters are too large"},{status:413,headers:responseHeaders});}chunks.push(part.value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const input=JSON.parse(new TextDecoder().decode(bytes));
      if(!input||Object.keys(input).some(key=>!["name","scope","args"].includes(key)))throw new SyntaxError("Invalid read envelope");
      name=input.name;scope=input.scope;args=input.args;
    } else {
      const url = new URL(request.url), raw = url.searchParams.get("args") ?? "{}";
      name=url.searchParams.get("name")??"";scope=url.searchParams.get("scope")??"";
      if(raw.length>65536)throw new SyntaxError("Page filters are too large");args=JSON.parse(raw);
    }
    if (typeof name!=="string"||!/^[a-z][a-z0-9.-]{0,79}$/.test(name) || !isAppLocalScopeId(scope)) return json({ error: "Invalid page request" }, { status: 400, headers: responseHeaders });
    if (!args || typeof args !== "object" || Array.isArray(args)) return json({ error: "Invalid page filters" }, { status: 400, headers: responseHeaders });
    const options = { scope, etag: request.headers.get("if-none-match") ?? undefined, signal: request.signal };
    // The readers include their own authorization; load measures that complete wait.
    const value = await timing.measure("load", async () => await readAppLocalOwnerResource(name, args as Record<string, unknown>, options)
      ?? await readAppLocalRoleResource(name, args, options)
      ?? await readAppLocalPlatformResource(name, args as Record<string, unknown>, options)
      ?? await readAppLocalHttpResource(name, args as Record<string, unknown>, options)
      ?? await readAppLocalRoleHttpResource(name, args as Record<string, unknown>, options)
      ?? await readAppLocalPersonalResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalStaffRelayResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalExploreResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalOwnerPageResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalBusinessResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalPublicResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalDailyResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalBusinessHttpResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalSecondaryResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalPayrollTaxResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalCommerceResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalShellResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalPortableResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalPortableHttpResource(name,args as Record<string,unknown>,options)
      ?? await readAppLocalDisplayResource(name,args as Record<string,unknown>,options));
    if (!value) return json({ error: "This page is unavailable" }, { status: 404, headers: responseHeaders });
    const resultHeaders = { ...responseHeaders, ETag: value.etag, "x-reylumi-scope": value.scope };
    return value.status === 304 ? timing.finish(new Response(null, { status: 304, headers: resultHeaders })) : json(value, { headers: resultHeaders });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && [400, 401, 403, 404, 409, 503].includes(Number(error.status)) ? Number(error.status) : error instanceof SyntaxError ? 400 : 503;
    return json({ error: status === 401 || status === 403 || status === 409 ? "Your access has changed. Please sign in again." : "Could not update this page. Please try again." }, { status, headers: responseHeaders });
  }
}
export async function GET(request:Request){return runWithReadContext(() => readPage(request));}
/** Large search windows are still named read-only resources; POST is only a transport. */
export async function POST(request:Request){return runWithReadContext(() => readPage(request));}

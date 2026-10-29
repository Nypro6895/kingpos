import { runWithReadContext } from "@/lib/read-context-scope";
import { getCurrentBusinessContext, projectSelectedWorkspaceRead } from "@/lib/current-context";
import { cookies } from "next/headers";
import { runInBusinessContext } from "@/lib/scoped-business-context";
import { GET as readSelectedContext } from "@/app/api/app-local/context/route";
import { connection } from "next/server";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { getCurrentStaffBusinessContext } from "@/lib/current-context";
import { runAppLocalCommand } from "@/lib/app-local-commands-server.generated";
import { decodeAppLocalValue } from "@/lib/app-local-command-codec";
import { runAppLocalHttpCommand } from "@/lib/app-local-http-server";
import { runAppLocalRoleHttpCommand } from "@/lib/app-local-role-http-server";
import { runAppLocalPersonalCommand } from "@/lib/app-local-personal-resources-server";
import { runAppLocalExploreHttpCommand } from "@/lib/app-local-explore-server";
import { runAppLocalPublicHttpCommand } from "@/lib/app-local-public-server";
import { runAppLocalUploadCommand, AppLocalUploadError } from "@/lib/app-local-upload-server";
import { runAppLocalShellCommand } from "@/lib/app-local-shell-server";
import { runAppLocalPortableHttpCommand } from "@/lib/app-local-portable-http-server";
import { requireAppLocalPortableScope } from "@/lib/app-local-portable-context-server";
import { isAppLocalScopeId, isAppLocalPortableScopeId } from "@/lib/app-local-scope-id";
import portableActions from "@/lib/app-local-portable-actions.generated.json";
import { authorizeAppLocalDisplayCommand } from "@/lib/app-local-display-server";
import { APP_LOCAL_GUEST_HIDDEN_POSTS_READ } from "@/lib/app-local-guest-read-policy";
import { runWithAppLocalGetterReadScope } from "@/lib/app-local-getter-read-scope";
import { AuthAvailabilityError } from "@/lib/supabase/auth-rest";
import { createAppLocalCommandTrace, type AppLocalCommandTrace } from "@/lib/app-local-command-trace";
import type { AppLocalCommandFailureCode } from "@/lib/app-local-command-trace-protocol";

export async function POST(request: Request) {
  const trace = createAppLocalCommandTrace(request.headers);
  return trace.run(async () => {
    try { return trace.finish(await command(request, trace)); }
    catch (error) { trace.thrown(error); throw error; }
  });
}

async function command(request: Request, trace: AppLocalCommandTrace) {
  await connection();
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const failure = (status: number, error: string, code?: AppLocalCommandFailureCode, phase?: "auth" | "workspace" | "proxy_refresh") => {
    const classified = code ?? (status === 401 || status === 403 ? "access_denied" : status === 409 ? "workspace_changed" : status === 404 ? "unsupported_command" : status < 500 ? "invalid_request" : undefined);
    if (classified) trace.failure(classified, phase);
    return Response.json({ ok: false, error }, { status, headers: responseHeaders });
  };
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json")) return failure(403, "Please open the form again.");
  if ((await trace.measure("auth", () => headers())).get("x-reylumi-auth-unavailable") === "1") return failure(503, "Please reconnect and try again.", trace.proxyUnavailable ? "proxy_refresh_unavailable" : "auth_unavailable", trace.proxyUnavailable ? "proxy_refresh" : "auth");
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 262144) return failure(413, "Open the online page to attach a larger file.");
    const reader = request.body?.getReader(); let length = 0; const chunks: Uint8Array[] = [];
    if (!reader) return failure(400, "Invalid form.");
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 262144) { await reader.cancel(); return failure(413, "Open the online page to attach a larger file."); } chunks.push(chunk.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || typeof input.name !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(input.name) || !/^[a-f0-9-]{36}$/i.test(input.requestId ?? "") || !isAppLocalScopeId(input.scope) || !input.args || typeof input.args !== "object" || Array.isArray(input.args)) return failure(400, "Invalid form.");
    trace.setCommand(input.name);
    if (input.name === APP_LOCAL_GUEST_HIDDEN_POSTS_READ &&
      (Object.keys(input.args).length !== 1 || !Array.isArray(input.args.values) || input.args.values.length !== 0)) {
      return failure(400, "Invalid hidden-post read.");
    }
    if(/^action\.[a-f0-9]{24}$/.test(input.name)&&Object.keys(input.args).every(key=>key==="values")){
      const values=decodeAppLocalValue(input.args.values);
      if(!Array.isArray(values)||values.length>20)return failure(400,"Invalid form.");
      if(await trace.measure("workspace", () => authorizeAppLocalDisplayCommand(input.name,values,input.scope)))return Response.json({ok:true,data:{value:await trace.measure("handler", () => runAppLocalCommand(input.name,values))}},{headers:responseHeaders});
    }
    if(isAppLocalPortableScopeId(input.scope)){
      await trace.measure("workspace", () => requireAppLocalPortableScope(input.scope));
      const portable=await trace.measure("handler", () => runAppLocalPortableHttpCommand(input.name,input.args,request,input.scope));
      if(portable.handled)return Response.json({ok:true,data:portable.data},{headers:responseHeaders});
      if(!portableActions.ids.includes(input.name)||Object.keys(input.args).some(key=>key!=="values"))return failure(403,"This POS device cannot perform that action.");
      const values=decodeAppLocalValue(input.args.values);if(!Array.isArray(values)||values.length>20)return failure(400,"Invalid form.");
      return Response.json({ok:true,data:{value:await trace.measure("handler", () => runAppLocalCommand(input.name,values))}},{headers:responseHeaders});
    }
    if (input.name === "shell.switch-workspace") {
      const shell = await runWithReadContext(async () => {
        const business = await trace.measure("auth", () => getRequestBusinessContext());
        const result = await runAppLocalShellCommand(input.name,input.args,request,input.scope,business);
        const data = result.data as {path:string;admission?:unknown}|undefined;
        if(result.handled && data && input.protocol === 2 && typeof input.generation === "string" && /^[\w-]{16,100}$/.test(input.generation)) {
          try {
            // The selector changes cookies, never membership or business data.
            // Re-project the same fresh self graph; original page readers and
            // their final revocation probes still own their authorization.
            let target;
            try { target = await projectSelectedWorkspaceRead(business,input.args.workspaceId); }
            catch { target = await getCurrentBusinessContext({cookieStore:await cookies()}); }
            data.admission = await runInBusinessContext(target,async () => {
              const targetURL = new URL("/api/app-local/context",origin);
              targetURL.search = new URLSearchParams({path:data.path,generation:input.generation}).toString();
              const forwarded = new Headers(request.headers);
              forwarded.set("X-Reylumi-Staff-Online-Access","1");forwarded.set("X-Reylumi-Initial-Data","1");
              const response = await readSelectedContext(new Request(targetURL,{headers:forwarded}));
              return response.ok ? await response.json() : undefined;
            });
          } catch { /* Selection may be committed; never replay the write. */ }
        }
        return result;
      });
      if(!shell.handled) return failure(400,"Choose a workspace.");
      return Response.json({ok:true,data:shell.data},{headers:responseHeaders});
    }
    return await runWithAppLocalGetterReadScope(input.name, async () => {
      const business = await trace.measure("auth", () => getRequestBusinessContext());
      const upload=await trace.measure("handler", () => runAppLocalUploadCommand(input.name,input.args,input.scope));
      if(upload.handled)return Response.json({ok:true,data:upload.data},{headers:responseHeaders});
      if (!business.user && input.name === APP_LOCAL_GUEST_HIDDEN_POSTS_READ) {
        if (getExperienceContext(business).scope !== input.scope) return failure(409, "Your account has changed.");
        // The unchanged original handler binds this read to the abuse-signed
        // guest device. It accepts no supplied identity or moderation operation.
        return Response.json({ ok: true, data: { value: await trace.measure("handler", () => runAppLocalCommand(input.name, [])) } }, { headers: responseHeaders });
      }
      if(input.name==="http.explore.feed-events"&&getExperienceContext(business).scope===input.scope){const events=await trace.measure("handler", () => runAppLocalExploreHttpCommand(input.name,input.args,request,input.scope));if(events.handled)return Response.json({ok:true,data:events.data},{headers:responseHeaders});}
      if(input.name==="http.public-booking.confirm"&&getExperienceContext(business).scope===input.scope){const booking=await trace.measure("handler", () => runAppLocalPublicHttpCommand(input.name,input.args,request,input.scope));if(booking.handled)return Response.json({ok:true,data:booking.data},{headers:responseHeaders});}
      if(["http.shell.advertising-event","http.shell.campaign-event"].includes(input.name)&&getExperienceContext(business).scope===input.scope){const events=await trace.measure("handler", () => runAppLocalShellCommand(input.name,input.args,request,input.scope));if(events.handled)return Response.json({ok:true,data:events.data},{headers:responseHeaders});}
      if (!business.user) return failure(401, "Please sign in again.", "access_denied", "auth");
      if (getExperienceContext(business).scope !== input.scope) {
        const staff = await trace.measure("workspace", () => getStaffPortalIdentity());
        if (staff.context.user?.id !== business.user.id || !staff.staff || getExperienceContext(staff.context).scope !== input.scope) {
          const workday=await trace.measure("workspace", () => getCurrentStaffBusinessContext());
          if(workday.user?.id!==business.user.id||getExperienceContext(workday).scope!==input.scope)return failure(409,"Your workspace changed. Please open the form again.");
        }
      }
      const originalHTTP = await trace.measure("handler", () => runAppLocalHttpCommand(input.name, input.args, request, input.scope));
      const shell=await trace.measure("handler", () => runAppLocalShellCommand(input.name,input.args,request,input.scope,input.name==="shell.switch-workspace"?business:undefined));
      if(shell.handled)return Response.json({ok:true,data:shell.data},{headers:responseHeaders});
      if (originalHTTP.handled) return Response.json({ ok: true, data: originalHTTP.data }, { headers: responseHeaders });
      const roleHTTP = await trace.measure("handler", () => runAppLocalRoleHttpCommand(input.name, input.args, request, input.scope));
      if (roleHTTP.handled) return Response.json({ ok: true, data: roleHTTP.data }, { headers: responseHeaders });
      const personalHTTP=await trace.measure("handler", () => runAppLocalPersonalCommand(input.name,input.args,request,input.scope));
      if(personalHTTP.handled)return Response.json({ok:true,data:personalHTTP.data},{headers:responseHeaders});
      if (!/^action\.[a-f0-9]{24}$/.test(input.name) || Object.keys(input.args).some(key => key !== "values")) return failure(400, "Invalid form.");
      const values = decodeAppLocalValue(input.args.values);
      if (!Array.isArray(values) || values.length > 20) return failure(400, "Invalid form.");
      // Each compile-pinned original handler performs its own current permissions,
      // record ownership, PIN and business validation. This transport never queues
      // or retries writes; the original idempotent POS outbox remains separate.
      const value = await trace.measure("handler", () => runAppLocalCommand(input.name, values));
      return Response.json({ ok: true, data: { value } }, { headers: responseHeaders });
    });
  } catch (error) {
    trace.error(error, error instanceof AuthAvailabilityError ? "auth_unavailable" : error instanceof AppLocalUploadError ? "upload_error" : undefined);
    if(error instanceof AppLocalUploadError)return failure(error.status,error.message);
    const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
    if (digest.startsWith("NEXT_REDIRECT;")) {
      const path = digest.split(";").slice(2, -2).join(";");
      if (path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f]/.test(path)) return Response.json({ ok: true, data: { redirect: path } }, { headers: responseHeaders });
    }
    const status=error&&typeof error==="object"&&"status"in error?Number(error.status):0;
    if([400,401,403,404,409].includes(status))return failure(status,status===401||status===403?"Your access must be checked again.":status===409?"Your workspace changed. Please open the form again.":"Please open the form again.");
    return failure(503, "The result could not be confirmed. Please check the current record before trying again.");
  }
}

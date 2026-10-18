import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const enabled = Boolean(process.env.ESBUILD_MODULE_PATH);
test(
  "API derives audience from the authenticated workspace and rejects guest popup claims",
  { skip: !enabled },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
    );
    const built = await build({
      entryPoints: ["app/api/explore/advertising/route.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      plugins: [
        {
          name: "context",
          setup(b) {
            b.onResolve(
              {
                filter:
                  /^(next\/server|@\/lib\/(explore-advertising|request-business-context|advertising-attribution))$/,
              },
              (a) => ({ path: a.path, namespace: "stub" }),
            );
            b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
              loader: "js",
              contents:
                a.path === "next/server"
                  ? `export const NextResponse={json(body,init){const response=new Response(JSON.stringify(body),init);response.cookies={set(){}};return response;}};`
                  : a.path.endsWith("advertising-attribution")
                    ? `export const AD_ATTRIBUTION_COOKIE='ad-attribution';export const signAdAttribution=()=> 'test-signature';`
                    : a.path.endsWith("request-business-context")
                      ? `export async function getRequestBusinessContext(){return globalThis.targetContext;}`
                      : `export async function getAdvertisingLimits(){return {sessionMinutes:30}};export async function getCampaigns(){return globalThis.targetCampaigns;}export function advertisingClient(){return {rpc:async()=>{globalThis.claims++;return {data:true,error:null}},from:()=>({select:()=>({eq:()=>({in:async()=>({data:[],error:null})})})})};}`,
            }));
          },
        },
      ],
    });
    const { GET, POST } = await import(
      "data:text/javascript;base64," +
        Buffer.from(built.outputFiles[0].text).toString("base64")
    );
    const secret = process.env.ADVERTISING_IP_HASH_SECRET;
    process.env.ADVERTISING_IP_HASH_SECRET = "test-targeting-secret";
    const request = (path, body) => ({
      nextUrl: new URL(
        "https://example.test/api/explore/advertising?path=" +
          encodeURIComponent(path) +
          "&device=mobile",
      ),
      headers: new Headers({ origin: "https://example.test" }),
      cookies: {
        get: () => ({ value: "1650370b-f86d-461e-8d97-6210052eeee7" }),
      },
      json: async () => body,
    });
    try {
      globalThis.claims = 0;
      globalThis.targetCampaigns = [
        {
          id: "1650370b-f86d-461e-8d97-6210052eeed7",
          kind: "popup",
          name: "Owner campaign",
          repeat: "always",
          audiences: ["owner"],
          locations: ["/bookings"],
          devices: ["mobile"],
        },
      ];
      globalThis.targetContext = {
        user: null,
        workspaceType: "personal",
        salonMode: null,
      };
      assert.deepEqual(
        (await (await GET(request("/bookings"))).json()).campaigns,
        [],
      );
      const denied = await POST(
        request("/bookings", {
          id: globalThis.targetCampaigns[0].id,
          path: "/bookings",
          device: "mobile",
          event: "view",
        }),
      );
      assert.equal(denied.status, 403);
      assert.equal(globalThis.claims, 0);
      globalThis.targetContext = {
        user: { id: "owner" },
        workspaceType: "salon",
        salonMode: "manage",
      };
      assert.equal(
        (await (await GET(request("/bookings"))).json()).campaigns.length,
        1,
      );
      assert.equal(
        (await (await GET(request("/staff"))).json()).campaigns.length,
        0,
      );
      const allowed = await POST(
        request("/bookings", {
          id: globalThis.targetCampaigns[0].id,
          path: "/bookings",
          device: "mobile",
          event: "view",
        }),
      );
      assert.equal((await allowed.json()).allowed, true);
      assert.equal(globalThis.claims, 1);
    } finally {
      if (secret === undefined) delete process.env.ADVERTISING_IP_HASH_SECRET;
      else process.env.ADVERTISING_IP_HASH_SECRET = secret;
    }
  },
);

import { createServer } from "node:http";
import {
  randomBytes,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import QRCode from "qrcode";
import { AsyncLocalStorage } from "node:async_hooks";
import { isPostgresStore } from "./postgres-store.mjs";
import { retryAttemptIsLive } from "./refresh-attempt.mjs";
const groups = ["profile", "services", "media", "content"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const escape = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safeEqual = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function listPrice(service) {
  if (service.priceKind === "on-request" || service.amountCents === null)
    return "Price on request";
  const f = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: service.currency,
  });
  const digits = f.resolvedOptions().maximumFractionDigits;
  return (
    (service.priceKind === "from" ? "From " : "") +
    f.format(service.amountCents / 10 ** digits)
  );
}
class MenuError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
class ReadRequiresWrite extends Error {}
export function createQrMenuHandler({
  api,
  clientId,
  clientSecret,
  publicOrigin,
  sandboxToken,
  fetcher = fetch,
  secureCookie = true,
  store,
  ownerIdentity,
}) {
  for (const value of [api, publicOrigin]) {
    const u = new URL(value);
    if (
      u.origin !== value ||
      u.username ||
      u.password ||
      !(
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(u.hostname))
      )
    )
      throw Error("Use an HTTPS origin or explicit loopback origin");
  }
  if (sandboxToken) {
    if (
      !/^rmp_[A-Za-z0-9_-]{43}$/.test(sandboxToken) ||
      !["127.0.0.1", "localhost"].includes(new URL(publicOrigin).hostname)
    )
      throw Error("Sandbox preview is loopback-only");
  } else if (
    !uuid.test(clientId) ||
    !/^rmc_[A-Za-z0-9_-]{43}$/.test(clientSecret)
  )
    throw Error("Configure backend confidential client credentials");
  const hosted = !["127.0.0.1", "localhost"].includes(new URL(publicOrigin).hostname) || process.env.NODE_ENV === "production";
  if (store && !isPostgresStore(store, { api, clientId, publicOrigin }))
    throw Error("Durable store must match the exact API, app and public origin.");
  if (hosted && (!store || !secureCookie || typeof ownerIdentity !== "function" || sandboxToken))
    throw Error("Hosted runtime requires encrypted PostgreSQL store, secure cookies and backend ownerIdentity.");
  const context = new AsyncLocalStorage();
  const demo = { sessions: [], menus: [], byInstallation: [] };
  let demoQueue = Promise.resolve();
  const cookieName = hosted ? "__Host-qr_owner" : "qr_owner";
  async function checkpoint() {
    const current = context.getStore();
    if(current.readOnly)return;
    current.state.sessions = [...current.sessions];
    current.state.menus = [...current.menus];
    current.state.byInstallation = [...current.byInstallation];
    await current.save();
  }
  const now = () => context.getStore()?.now() ?? Date.now();
  const random = () => randomBytes(32).toString("base64url");
  const retryable = record => retryAttemptIsLive(record,now());
  async function exchange(body) {
    const r = await fetcher(api + "/api/market-platform/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw new MenuError(
        r.status === 403 ? 410 : 503,
        "Connection unavailable. Reconnect from Market.",
      );
    const g = await r.json();
    if (
      !/^rmp_[A-Za-z0-9_-]{43}$/.test(g.access_token) ||
      !/^rmr_[A-Za-z0-9_-]{43}$/.test(g.refresh_token) ||
      !Number.isFinite(Date.parse(g.refresh_expires_at)) || Date.parse(g.refresh_expires_at) <= now()
    )
      throw new MenuError(503, "Invalid API grant response");
    return g;
  }
  async function authorized(record, path) {
    const current=context.getStore();
    if(record.refreshUncertain && current.readOnly){
      if(current.writerActive)throw new MenuError(503,"Connection refresh is in progress. Please try again.");
      if(retryable(record))throw new ReadRequiresWrite();
    }
    if (record.reconnectRequired) throw new MenuError(410, "Reconnect this app from Market.");
    let response = record.refreshUncertain ? null : await fetcher(api + path, {
      headers: { Authorization: "Bearer " + record.grant.access_token },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response || response.status === 403) {
      if (record.syntheticMode === true || record.syntheticMode === "bearer")
        throw new MenuError(410, "Sandbox expired or request limit reached.");
      if(context.getStore().readOnly)throw new ReadRequiresWrite();
      // Commit uncertainty BEFORE sending the rotating token to the provider.
      // Only the exact attempt can recover its encrypted receipt for 90 seconds.
      // Older/expired uncertainty requires reconnect, without rotating again.
      if(!record.refreshAttempt){record.refreshAttempt={id:randomUUID(),key:"rmk_"+random(),startedAt:now()};record.refreshUncertain=true;await checkpoint();}
      if(!retryable(record))throw new MenuError(410,"Reconnect this app from Market.");
      try{
        const g = await exchange({ grant_type: "refresh_token", refresh_token: record.grant.refresh_token,request_id:record.refreshAttempt.id,retry_key:record.refreshAttempt.key });
        record.grant = g;delete record.refreshUncertain;delete record.refreshAttempt;await checkpoint();
      }catch(error){
        if(error instanceof MenuError && error.status===410){record.grant=null;record.reconnectRequired=true;delete record.refreshUncertain;delete record.refreshAttempt;await checkpoint();}
        throw error;
      }
      response = await fetcher(api + path, {
        headers: { Authorization: "Bearer " + record.grant.access_token },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
    }
    return response;
  }
  async function load(record) {
    const result = {};
    for (const group of groups) {
      const response = await authorized(
        record,
        "/api/market-platform/v1/published/" + group,
      );
      if (response.status === 404 && ["media", "content"].includes(group)) {
        result[group] = {
          data: group === "media" ? { images: [] } : { entries: [] },
          unpublished: true,
        };
        continue;
      }
      if (!response.ok)
        throw new MenuError(
          response.status === 404
            ? 404
            : response.status === 401 || response.status === 403
              ? 410
              : 503,
          "This menu is unavailable or no longer shared.",
        );
      if (Number(response.headers.get("content-length") ?? 0) > 140000)
        throw new MenuError(503, "API response too large");
      const text = await response.text();
      if (Buffer.byteLength(text) > 140000)
        throw new MenuError(503, "API response too large");
      const out = JSON.parse(text);
      if (record.syntheticMode) {
        if (out.synthetic !== true)
          throw new MenuError(403, "Sandbox preview refuses real salon data.");
        if (!record.installation) record.installation = out.installationId;
      }
      if (
        out.schemaVersion !== 1 ||
        out.group !== group ||
        out.installationId !== record.installation ||
        !uuid.test(out.salonId) ||
        !uuid.test(out.versionId) ||
        (record.salonId && record.salonId !== out.salonId) ||
        (record.versionId && record.versionId !== out.versionId)
      )
        throw new MenuError(503, "API identity mismatch");
      if (
        result.profile &&
        (out.salonId !== result.profile.salonId ||
          out.versionId !== result.profile.versionId)
      )
        throw new MenuError(503, "API version mismatch");
      result[group] = out;
    }
    record.salonId = result.profile.salonId;
    record.versionId = result.profile.versionId;
    return result;
  }
  const css = `*{box-sizing:border-box}body{margin:0;font:16px system-ui,sans-serif;background:#f5f8f6;color:#183a31}main{max-width:980px;margin:auto;padding:32px 20px 70px}header{text-align:center;padding:28px 10px}h1{font-size:clamp(30px,6vw,52px);margin:14px 0}h2{font-size:24px}p{line-height:1.6}a{color:var(--brand)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card,details{background:white;border:1px solid #d8e4df;border-radius:14px;padding:20px;margin:12px 0}.price{font-size:22px;font-weight:700;color:var(--brand)}.muted{color:#527067;font-size:14px}img{max-width:100%;border-radius:12px}.gallery img{width:100%;height:220px;object-fit:cover}.logo{width:100px;height:100px;object-fit:contain}summary{cursor:pointer;font-weight:600}.qr{width:320px;image-rendering:pixelated}.actions{display:flex;gap:16px;flex-wrap:wrap}footer{border-top:1px solid #d8e4df;margin-top:36px;padding-top:20px;font-size:13px}.text{white-space:pre-wrap}@media(max-width:600px){main{padding:18px 14px 50px}.grid{grid-template-columns:1fr}.card{padding:16px}}`;
  function html(res, title, body, color = "#145946") {
    const nonce = random();
    const brand = /^#[a-f0-9]{6}$/i.test(color) ? color : "#145946";
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style nonce="${nonce}">:root{--brand:${brand}}${css}</style></head><body><main>${body}</main></body></html>`,
    );
  }
  const handle = async (req, res) => {
    const { sessions, menus, byInstallation } = context.getStore();
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(req.url, publicOrigin);
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    for (const [id, s] of sessions)
      if (s.expires < now()) sessions.delete(id);
    for (const [, m] of menus)
      if (m.grant && Date.parse(m.grant.refresh_expires_at) <= now()) {
        m.grant = null;
        m.reconnectRequired = true;
      }
    const cookie = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    const session = sessions.get(cookie);
    try {
      let principal;
      if (ownerIdentity && ["/connect", "/manage"].includes(url.pathname)) {
        const subject = await ownerIdentity(req);
        if (typeof subject !== "string" || !subject || subject.length > 256)
          throw new MenuError(403, "Sign in to this app before opening it from Market.");
        principal = createHash("sha256").update(subject).digest("hex");
        if (session && session.principal !== principal)
          throw new MenuError(403, "Invalid owner session.");
      }
      if (url.pathname === "/sandbox") {
        if (!sandboxToken)
          throw new MenuError(404, "Sandbox mode is not configured.");
        if (menus.size >= 500)
          throw new MenuError(429, "Menu capacity reached.");
        const candidate = {
          syntheticMode: true,
          grant: {
            access_token: sandboxToken,
            refresh_expires_at: new Date(
              now() + 24 * 3600000,
            ).toISOString(),
          },
        };
        await load(candidate);
        const menuId = randomUUID(),
          owner = random();
        menus.set(menuId, candidate);
        sessions.set(owner, {
          menu: menuId,
          expires: now() + 24 * 3600000,
          synthetic: true,
        });
        res.setHeader(
          "Set-Cookie",
          `qr_owner=${owner}; HttpOnly; SameSite=Lax; Path=/`,
        );
        res.writeHead(303, { Location: "/manage" }).end();
        return;
      }
      if (url.pathname === "/connect") {
        if (url.searchParams.has("reylumi_installation")) {
          if (
            url.searchParams.get("reylumi_client_id") !== clientId ||
            url.searchParams.get("reylumi_authorize_url") !==
              api + "/api/market-platform/authorize" ||
            !uuid.test(url.searchParams.get("reylumi_installation") ?? "")
          )
            throw new MenuError(403, "Start from your salon Market.");
          if (sessions.size >= 1000)
            throw new MenuError(429, "Too many sessions.");
          const id = random(),
            state = random(),
            verifier = random();
          sessions.set(id, {
            state,
            principal,
            generation: menus.get(byInstallation.get(url.searchParams.get("reylumi_installation")))?.generation,
            verifier,
            syntheticRequested: url.searchParams.get("reylumi_sandbox") === "true",
            installation: url.searchParams.get("reylumi_installation"),
            expires: now() + 60000,
          });
          res.setHeader(
            "Set-Cookie",
            `${cookieName}=${id}; HttpOnly; SameSite=Lax; Path=/${secureCookie ? "; Secure" : ""}`,
          );
          const auth = new URL(api + "/api/market-platform/authorize");
          for (const [k, v] of Object.entries({
            client_id: clientId,
            installation_id: url.searchParams.get("reylumi_installation"),
            response_type: "code",
            state,
            code_challenge_method: "S256",
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
          }))
            auth.searchParams.set(k, v);
          if (url.searchParams.get("reylumi_sandbox") === "true") auth.searchParams.set("sandbox", "true");
          res.writeHead(303, { Location: auth.href }).end();
          return;
        }
        if (
          !session?.verifier ||
          !safeEqual(url.searchParams.get("state"), session.state) ||
          !/^rma_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code") ?? "")
        )
          throw new MenuError(403, "Invalid or expired callback.");
        const previous = menus.get(byInstallation.get(session.installation));
        if (session.generation !== previous?.generation)
          throw new MenuError(403, "Connection changed. Open again from Market.");
        const verifier = session.verifier;
        delete session.verifier;
        delete session.state;
        await checkpoint(); // Consume callback durably before external I/O.
        const grant = await exchange({
          grant_type: "authorization_code",
          code: url.searchParams.get("code"),
          code_verifier: verifier,
        });
        const candidate = { grant, installation: session.installation, salonId: previous?.salonId, generation: randomUUID(),syntheticMode:session.syntheticRequested?"oauth":undefined };
        const data = await load(candidate);
        if(data.profile.synthetic)candidate.syntheticMode="oauth";
        if (menus.size >= 500 && !byInstallation.has(candidate.installation))
          throw new MenuError(429, "Menu capacity reached.");
        const publicId =
          byInstallation.get(candidate.installation) ?? randomUUID();
        menus.set(publicId, candidate);
        byInstallation.set(candidate.installation, publicId);
        session.menu = publicId;
        session.generation = candidate.generation;
        session.expires = Math.min(
          now() + 30 * 86400000,
          Date.parse(grant.refresh_expires_at) || 0,
        );
        session.synthetic = data.profile.synthetic;
        res.writeHead(303, { Location: "/manage" }).end();
        return;
      }
      if (url.pathname === "/manage") {
        if (!session?.menu)
          throw new MenuError(403, "Open this app from your salon Market.");
        const record = menus.get(session.menu);
        if (!record || record.generation !== session.generation) throw new MenuError(410, "Reconnect this app from Market.");
        const data = await load(record);
        if(hosted && data.profile.synthetic){
          html(res,"Synthetic connection preview",`<header><h1>Synthetic connection preview</h1><p>${escape(data.profile.data.displayName)}</p></header><section class="card"><p>Synthetic test data only. Authorization and scoped reads are working. No public QR or menu is issued for this test connection.</p><h2>Test services</h2>${data.services.data.services.map(s=>`<p>${escape(s.name)} · ${escape(listPrice(s))}</p>`).join("")}</section>`,data.profile.data.brandColor);
          return;
        }
        const link = new URL("/menu/" + session.menu, publicOrigin).href;
        html(
          res,
          "Your QR menu",
          `<header><h1>Your salon QR menu</h1><p>${escape(data.profile.data.displayName)}</p></header><section class="card"><img class="qr" alt="QR code to this published menu" src="/qr/${session.menu}.png"><p><a href="${escape(link)}">Preview responsive menu</a></p><p class="muted text">${escape(link)}</p><div class="actions"><a href="/qr/${session.menu}.png?download=1">Download PNG</a><a href="/qr/${session.menu}.svg?download=1">Download SVG</a></div><p>This QR contains only the public menu URL. No access token, client secret or customer information is encoded.</p><p>Local loopback URLs work only where this host can be reached. This example is not public hosting.</p></section>`,
          data.profile.data.brandColor,
        );
        return;
      }
      const match = url.pathname.match(
        /^\/(menu|qr)\/([a-f0-9-]{36})(?:\.(png|svg)|\/image\/([a-f0-9-]{36}))?$/i,
      );
      if (!match) throw new MenuError(404, "Menu not found.");
      const [, kind, id, format, asset] = match,
        record = menus.get(id);
      if (!record) throw new MenuError(404, "Menu not found.");
      if(hosted && record.syntheticMode)throw new MenuError(403,"Synthetic menus are private test data. Open the authenticated preview.");
      const data = await load(record),
        p = data.profile.data;
      if(hosted && data.profile.synthetic)throw new MenuError(403,"Synthetic menus are private test data. Open the authenticated preview.");
      if (kind === "qr" && format) {
        const target = new URL("/menu/" + id, publicOrigin).href;
        const value =
          format === "png"
            ? await QRCode.toBuffer(target, {
                width: 512,
                margin: 4,
                errorCorrectionLevel: "M",
              })
            : await QRCode.toString(target, {
                type: "svg",
                margin: 4,
                errorCorrectionLevel: "M",
              });
        res.setHeader(
          "Content-Type",
          format === "png" ? "image/png" : "image/svg+xml",
        );
        if (url.searchParams.get("download") === "1")
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="salon-menu-qr.${format}"`,
          );
        res.end(value);
        return;
      }
      if (kind !== "menu" || format)
        throw new MenuError(404, "Menu not found.");
      if (asset) {
        if (!data.media.data.images.some((x) => x.assetId === asset))
          throw new MenuError(404, "Photo no longer shared.");
        const image = await authorized(
          record,
          "/api/market-platform/v1/published/media/" + asset,
        );
        if (!image.ok)
          throw new MenuError(
            image.status === 404 ? 404 : 503,
            "Photo unavailable.",
          );
        const parts = [];
        let size = 0;
        for await (const part of image.body) {
          size += part.length;
          if (size > 1048576) throw new MenuError(503, "Photo unavailable.");
          parts.push(part);
        }
        const bytes = Buffer.concat(parts);
        if (
          bytes.length > 1048576 ||
          image.headers.get("content-type") !== "image/webp"
        )
          throw new MenuError(503, "Photo unavailable.");
        res.setHeader("Content-Type", "image/webp");
        res.end(bytes);
        return;
      }
      const photo = (image) =>
        `<img src="/menu/${id}/image/${image.assetId}" alt="${escape(image.label)}" loading="lazy">`;
      const logo = data.media.data.images.find((x) => x.role === "logo");
      const hours = Array.from({ length: 7 }, (_, day) => {
        const h = p.hours.find((x) => x.day === day);
        return `<li>${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}: ${h ? (h.closed ? "Closed" : escape(h.opens) + "–" + escape(h.closes)) : "Not provided"}</li>`;
      }).join("");
      html(
        res,
        p.displayName + ": Menu",
        `<header>${logo ? photo(logo) : ""}<p class="muted">PUBLIC SALON MENU${data.profile.synthetic ? " · SYNTHETIC TEST DATA" : ""}</p><h1>${escape(p.displayName)}</h1><p>${escape(p.tagline)}</p></header><section class="card"><h2>Visit us</h2>${p.businessAddress ? `<p>${escape(p.businessAddress)}</p>` : ""}${p.businessPhone ? `<p>Business phone: ${escape(p.businessPhone)}</p>` : ""}${p.website ? `<p><a rel="noopener noreferrer" href="${escape(p.website)}">Salon website</a></p>` : ""}<details><summary>Opening hours · ${escape(p.timezone)}</summary><ul>${hours}</ul></details></section><h2>Service menu</h2><div class="grid">${data.services.data.services.map((s) => `<article class="card"><p class="muted">${escape(s.category)}</p><h3>${escape(s.name)}</h3><p class="price">${escape(listPrice(s))}</p><p>${escape(s.description)}</p><p class="muted">${s.durationMinutes === null ? "Duration not provided" : escape(s.durationMinutes) + " minutes (listed duration)"}</p></article>`).join("") || "<p>No public services listed.</p>"}</div><p class="muted">Public list prices only. Taxes, tips, extras and actual availability are not calculated here. A “from” price is a starting price, not a final quote.</p><h2>Salon photos</h2><div class="grid gallery">${
          data.media.data.images
            .filter((x) => x.role !== "logo")
            .map(
              (x) =>
                `<figure class="card">${photo(x)}<figcaption>${escape(x.caption)} <span class="muted">(${escape(x.rights === "owner" ? "Salon-owned" : "Licensed")})</span></figcaption></figure>`,
            )
            .join("") || "<p>No photos shared.</p>"
        }</div><h2>FAQ, policies & guides</h2>${data.content.data.entries.map((x) => `<details><summary>${escape(x.title)} · ${escape(x.kind)}</summary><p class="text">${escape(x.body)}</p></details>`).join("") || "<p>No public content shared.</p>"}<footer>Published salon data, refreshed on each request. Profile revision ${escape(data.profile.revision)} · Menu revision ${escape(data.services.revision)}. This is a self-hosted example, not a Reylumi checkout or booking page.</footer>`,
        p.brandColor,
      );
    } catch (error) {
      if(error instanceof ReadRequiresWrite)throw error;
      res.statusCode = error instanceof MenuError ? error.status : 503;
      html(
        res,
        "Menu unavailable",
        `<section class="card"><h1>Menu unavailable</h1><p>${escape(error instanceof MenuError ? error.message : "Please try again later. No previous salon data is shown.")}</p></section>`,
      );
    }
  };
  return async (req, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    // Flush cookies, redirects and media only after the fenced commit succeeds.
    const headers = new Map();
    let body, status = 200;
    const buffered = {
      setHeader: (name, value) => headers.set(name, value),
      set statusCode(value) { status = value; },
      writeHead(code, values = {}) { status = code; for (const [k,v] of Object.entries(values)) headers.set(k,v); return this; },
      end(value) { body = value; },
    };
    const work = async (state, save, clock = Date.now, readOnly = false, writerActive = false) => {
      for (const [, record] of state.menus) {
        if (record.refreshUncertain && !retryAttemptIsLive(record,clock()) && !(readOnly && writerActive)) { record.grant = null; record.reconnectRequired = true; delete record.refreshUncertain;delete record.refreshAttempt; }
      }
      const current = { state, save, now: clock, readOnly, writerActive, sessions: new Map(state.sessions), menus: new Map(state.menus), byInstallation: new Map(state.byInstallation) };
      await context.run(current, async () => { await handle(req, buffered); await checkpoint(); });
    };
    try {
      if (store) {
        const publicRead=req.method==='GET' && /^\/(menu|qr)\/[a-f0-9-]{36}(?:\.(png|svg)|\/image\/[a-f0-9-]{36})?(?:\?.*)?$/i.test(req.url??'');
        if(publicRead)try{await store.read(work);}catch(error){
          if(!(error instanceof ReadRequiresWrite))throw error;
          headers.clear();body=undefined;status=200;
          await store.run(work);
        }
        else await store.run(work);
      }
      else {
        const pending = demoQueue.then(() => work(demo, async () => {}));
        demoQueue = pending.catch(() => {});
        await pending; // Loopback demonstration only; not durable storage.
      }
      for (const [k,v] of headers) response.setHeader(k,v);
      response.writeHead(status).end(body);
    } catch {
      response.writeHead(503, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }).end("Connection unavailable. Reconnect from Market if required.");
    }
  };
}
export function createQrMenuApp(options) { return createServer(createQrMenuHandler(options)); }

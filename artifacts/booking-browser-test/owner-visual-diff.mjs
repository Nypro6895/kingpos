import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { promisify } from "node:util";

const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.OWNER_DIFF_BASE_URL ?? "http://127.0.0.1:3361";
const salonId = process.env.OWNER_DIFF_SALON_ID ?? "7f599bc8-a806-4a68-be86-c149c21709e2";
const date = process.env.OWNER_DIFF_DATE ?? "2026-07-15";
const referencePath =
  process.env.OWNER_DIFF_REFERENCE ?? "C:\\Users\\giuse\\Downloads\\1.png";
const execFileAsync = promisify(execFile);

function parseDotEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        return [key, value];
      }),
  );
}

async function loadEnv() {
  let fileEnv = {};

  try {
    fileEnv = parseDotEnv(await readFile(".env.local", "utf8"));
  } catch {
    fileEnv = {};
  }

  return { ...fileEnv, ...process.env };
}

async function loadLinkedServiceRoleKey() {
  const projectRef = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
  const supabaseArgs = [
    "projects",
    "api-keys",
    "--project-ref",
    projectRef,
    "--output",
    "json",
  ];
  const command = process.platform === "win32" ? "cmd.exe" : "supabase";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "supabase.cmd", ...supabaseArgs]
      : supabaseArgs;
  const { stdout } = await execFileAsync(command, args, {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    maxBuffer: 1024 * 1024,
  });
  const keys = JSON.parse(stdout);
  const serviceRole = keys.find(
    (key) => key.id === "service_role" || key.name === "service_role",
  );

  if (!serviceRole?.api_key || serviceRole.api_key.includes("Â·")) {
    throw new Error("Linked Supabase CLI did not return a usable service role key.");
  }

  return serviceRole.api_key;
}

function assertOk(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }

  return result.data;
}

async function loadOwnerContext(admin) {
  const salon = assertOk(
    await admin
      .from("locations")
      .select("id, organization_id, name")
      .eq("id", salonId)
      .single(),
    "load owner salon",
  );
  const organization = assertOk(
    await admin
      .from("organizations")
      .select("id, name, owner_user_id")
      .eq("id", salon.organization_id)
      .single(),
    "load owner organization",
  );
  const owner = assertOk(
    await admin
      .from("users")
      .select("email")
      .eq("id", organization.owner_user_id)
      .single(),
    "load owner user",
  );

  if (!owner.email) {
    throw new Error("Owner user has no email for magic-link session.");
  }

  return { organization, owner, salon };
}

async function createOwnerSession(env, serviceRoleKey, ownerEmail) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const link = assertOk(
    await admin.auth.admin.generateLink({
      email: ownerEmail,
      type: "magiclink",
    }),
    "generate owner magic link",
  );
  const tokenHash = link.properties?.hashed_token;

  if (!tokenHash) {
    throw new Error("Supabase did not return a magic-link token hash.");
  }

  const verified = assertOk(
    await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    }),
    "verify owner magic link",
  );

  if (!verified.session) {
    throw new Error("Owner magic-link verification returned no session.");
  }

  return verified.session;
}

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ channel: "chrome", headless: true }),
    () => chromium.launch({ channel: "msedge", headless: true }),
    () => chromium.launch({ headless: true }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function maskRegions(width, height) {
  return [
    // KPI values and dynamic helper copy.
    { height: 62, left: 60, top: 240, width: Math.max(0, width - 120) },
    // Date and list row/empty-state content. Keep toolbar/cards/status geometry visible.
    { height: 28, left: 150, top: 500, width: 260 },
    { height: Math.max(0, height - 610), left: 0, top: 610, width },
    // Dynamic setup badge text can vary with tenant readiness.
    { height: 28, left: 150, top: 145, width: 150 },
  ];
}

function whiteSvg(width, height) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/></svg>`,
  );
}

async function maskedBuffer(input, regions, width, height) {
  return sharp(input)
    .resize(width, height, { fit: "fill" })
    .composite(
      regions.map((region) => ({
        input: whiteSvg(region.width, region.height),
        left: region.left,
        top: region.top,
      })),
    )
    .removeAlpha()
    .raw()
    .toBuffer();
}

function diffBuffers(current, reference) {
  let changed = 0;
  let totalDelta = 0;
  const threshold = 28;
  const diff = Buffer.alloc(current.length);

  for (let index = 0; index < current.length; index += 3) {
    const delta =
      Math.abs(current[index] - reference[index]) +
      Math.abs(current[index + 1] - reference[index + 1]) +
      Math.abs(current[index + 2] - reference[index + 2]);
    totalDelta += delta;

    if (delta > threshold) {
      changed += 1;
      diff[index] = 214;
      diff[index + 1] = 44;
      diff[index + 2] = 44;
    } else {
      const gray = Math.round(
        current[index] * 0.2126 + current[index + 1] * 0.7152 + current[index + 2] * 0.0722,
      );
      diff[index] = gray;
      diff[index + 1] = gray;
      diff[index + 2] = gray;
    }
  }

  return {
    changedPixels: changed,
    diff,
    meanChannelDelta: totalDelta / current.length,
    totalPixels: current.length / 3,
  };
}

const report = {
  baseUrl,
  date,
  diff: null,
  ok: false,
  referencePath,
  screenshots: [],
};

let browser;

try {
  await mkdir(artifactsDir, { recursive: true });
  const env = await loadEnv();

  if (
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    env.SUPABASE_SERVICE_ROLE_KEY = await loadLinkedServiceRoleKey();
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { organization, owner, salon } = await loadOwnerContext(admin);
  const session = await createOwnerSession(
    env,
    env.SUPABASE_SERVICE_ROLE_KEY,
    owner.email,
  );

  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { height: 941, width: 1914 },
  });
  await context.addCookies([
    {
      httpOnly: true,
      name: "sb-access-token",
      sameSite: "Lax",
      url: baseUrl,
      value: session.access_token,
    },
    {
      httpOnly: true,
      name: "sb-refresh-token",
      sameSite: "Lax",
      url: baseUrl,
      value: session.refresh_token,
    },
    {
      name: "kingpos-selected-workspace",
      sameSite: "Lax",
      url: baseUrl,
      value: `manage:${salon.id}`,
    },
    {
      name: "kingpos-current-organization-id",
      sameSite: "Lax",
      url: baseUrl,
      value: organization.id,
    },
    {
      name: "kingpos-current-manage-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: salon.id,
    },
    {
      name: "kingpos-current-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: salon.id,
    },
  ]);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/bookings?date=${date}&view=list`, {
    waitUntil: "networkidle",
  });
  const ownerSurface = page.locator('[data-booking-surface="owner"]');
  await ownerSurface.waitFor({ timeout: 15000 });
  const currentPath = path.join(artifactsDir, "owner-diff-current-surface.png");
  await ownerSurface.screenshot({ path: currentPath });
  report.screenshots.push("owner-diff-current-surface.png");

  const currentMeta = await sharp(currentPath).metadata();
  const width = currentMeta.width ?? 1610;
  const height = currentMeta.height ?? 941;
  const regions = maskRegions(width, height);
  const referenceResizedPath = path.join(artifactsDir, "owner-diff-reference-resized.png");
  const currentMaskedPath = path.join(artifactsDir, "owner-diff-current-masked.png");
  const referenceMaskedPath = path.join(artifactsDir, "owner-diff-reference-masked.png");
  const overlayPath = path.join(artifactsDir, "owner-diff-overlay.png");
  const diffPath = path.join(artifactsDir, "owner-diff-heatmap.png");

  await sharp(referencePath)
    .resize(width, height, { fit: "fill" })
    .png()
    .toFile(referenceResizedPath);
  report.screenshots.push("owner-diff-reference-resized.png");

  const currentMaskedPng = await sharp(currentPath)
    .resize(width, height, { fit: "fill" })
    .composite(
      regions.map((region) => ({
        input: whiteSvg(region.width, region.height),
        left: region.left,
        top: region.top,
      })),
    )
    .png()
    .toBuffer();
  const referenceMaskedPng = await sharp(referencePath)
    .resize(width, height, { fit: "fill" })
    .composite(
      regions.map((region) => ({
        input: whiteSvg(region.width, region.height),
        left: region.left,
        top: region.top,
      })),
    )
    .png()
    .toBuffer();

  await writeFile(currentMaskedPath, currentMaskedPng);
  await writeFile(referenceMaskedPath, referenceMaskedPng);
  report.screenshots.push("owner-diff-current-masked.png");
  report.screenshots.push("owner-diff-reference-masked.png");

  await sharp(referenceResizedPath)
    .composite([{ input: currentPath, blend: "over", opacity: 0.5 }])
    .png()
    .toFile(overlayPath);
  report.screenshots.push("owner-diff-overlay.png");

  const [currentRaw, referenceRaw] = await Promise.all([
    maskedBuffer(currentPath, regions, width, height),
    maskedBuffer(referencePath, regions, width, height),
  ]);
  const diff = diffBuffers(currentRaw, referenceRaw);
  await sharp(diff.diff, {
    raw: {
      channels: 3,
      height,
      width,
    },
  })
    .png()
    .toFile(diffPath);
  report.screenshots.push("owner-diff-heatmap.png");
  report.diff = {
    changedPixels: diff.changedPixels,
    height,
    maskedPixelDifferencePercent: Number(
      ((diff.changedPixels / diff.totalPixels) * 100).toFixed(2),
    ),
    meanChannelDelta: Number(diff.meanChannelDelta.toFixed(2)),
    maskRegions: regions,
    totalPixels: diff.totalPixels,
    width,
  };
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (browser) {
    await browser.close();
  }

  await writeFile(
    path.join(artifactsDir, "owner-visual-diff-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

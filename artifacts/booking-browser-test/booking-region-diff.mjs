import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const artifactsDir = path.resolve("artifacts/booking-browser-test");
const ownerReference =
  process.env.OWNER_REGION_REFERENCE ?? "C:\\Users\\giuse\\Downloads\\1.png";
const publicReference =
  process.env.PUBLIC_REGION_REFERENCE ??
  "C:\\Users\\giuse\\Downloads\\ccbc95f5-cf30-4b93-92fb-fb05ca505e9e.png";

const jobs = [
  {
    current: path.join(artifactsDir, "owner-diff-current-surface.png"),
    name: "owner",
    reference: ownerReference,
    regions: [
      { height: 200, left: 0, name: "header-tabs", top: 0, width: 1610 },
      { height: 150, left: 0, name: "kpi-row", top: 200, width: 1610 },
      { height: 130, left: 0, name: "toolbar-status", top: 350, width: 1610 },
      { height: 200, left: 0, name: "appointment-region", top: 480, width: 1610 },
    ],
  },
  {
    current: path.join(artifactsDir, "gateD-public-services-reference-desktop.png"),
    name: "public",
    reference: publicReference,
    regions: [
      { height: 110, left: 0, name: "stepper", top: 0, width: 1610 },
      {
        height: 760,
        left: 120,
        name: "editorial-content-shell",
        reference: { height: 760, left: 42, top: 120, width: 1536 },
        top: 120,
        width: 1370,
      },
      {
        height: 460,
        left: 315,
        name: "service-cards-addons",
        reference: { height: 460, left: 263, top: 370, width: 840 },
        top: 350,
        width: 750,
      },
      {
        height: 615,
        left: 1090,
        name: "sticky-summary",
        reference: { height: 615, left: 1135, top: 120, width: 450 },
        top: 120,
        width: 400,
      },
    ],
  },
];

function clampRegion(region, metadata) {
  return {
    height: Math.max(1, Math.min(region.height, metadata.height - region.top)),
    left: Math.max(0, Math.min(region.left, metadata.width - 1)),
    top: Math.max(0, Math.min(region.top, metadata.height - 1)),
    width: Math.max(1, Math.min(region.width, metadata.width - region.left)),
  };
}

async function rawCrop(file, region) {
  const image = sharp(file);
  const metadata = await image.metadata();
  const safeRegion = clampRegion(region, metadata);
  const { data, info } = await image
    .extract(safeRegion)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, info, region: safeRegion };
}

async function resizedReference(reference, currentMetadata) {
  const output = path.join(artifactsDir, "region-reference-resized.tmp.png");
  await sharp(reference)
    .resize(currentMetadata.width, currentMetadata.height, { fit: "fill" })
    .png()
    .toFile(output);

  return output;
}

async function diffRegion(job, region, referenceResized) {
  const current = await rawCrop(job.current, region);
  const referenceRaw = await rawCrop(referenceResized, region.reference ?? region);
  const referencePng = await sharp(referenceRaw.data, {
    raw: {
      channels: 4,
      height: referenceRaw.info.height,
      width: referenceRaw.info.width,
    },
  })
    .resize(current.info.width, current.info.height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const reference = {
    data: referencePng.data,
    info: referencePng.info,
  };
  const totalPixels = current.info.width * current.info.height;
  const overlay = Buffer.alloc(current.data.length);
  const heatmap = Buffer.alloc(current.data.length);
  let changedPixels = 0;
  let totalDelta = 0;

  for (let index = 0; index < current.data.length; index += 4) {
    const rDelta = Math.abs(current.data[index] - reference.data[index]);
    const gDelta = Math.abs(current.data[index + 1] - reference.data[index + 1]);
    const bDelta = Math.abs(current.data[index + 2] - reference.data[index + 2]);
    const delta = (rDelta + gDelta + bDelta) / 3;

    totalDelta += delta;

    if (delta > 18) {
      changedPixels += 1;
    }

    overlay[index] = Math.round(current.data[index] * 0.65 + 255 * 0.35);
    overlay[index + 1] = Math.round(current.data[index + 1] * 0.65);
    overlay[index + 2] = Math.round(current.data[index + 2] * 0.65);
    overlay[index + 3] = 255;

    const heat = Math.min(255, Math.round(delta * 4));
    heatmap[index] = heat;
    heatmap[index + 1] = 0;
    heatmap[index + 2] = 255 - heat;
    heatmap[index + 3] = 255;
  }

  const baseName = `${job.name}-region-${region.name}`;
  await sharp(overlay, {
    raw: {
      channels: 4,
      height: current.info.height,
      width: current.info.width,
    },
  })
    .png()
    .toFile(path.join(artifactsDir, `${baseName}-overlay.png`));
  await sharp(heatmap, {
    raw: {
      channels: 4,
      height: current.info.height,
      width: current.info.width,
    },
  })
    .png()
    .toFile(path.join(artifactsDir, `${baseName}-heatmap.png`));

  return {
    changedPixels,
    height: current.info.height,
    meanChannelDelta: Number((totalDelta / totalPixels).toFixed(2)),
    name: region.name,
    overlay: `${baseName}-overlay.png`,
    percent: Number(((changedPixels / totalPixels) * 100).toFixed(2)),
    heatmap: `${baseName}-heatmap.png`,
    width: current.info.width,
  };
}

await mkdir(artifactsDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  jobs: [],
};

for (const job of jobs) {
  const currentMetadata = await sharp(job.current).metadata();
  const referenceResized = await resizedReference(job.reference, currentMetadata);
  const regions = [];

  for (const region of job.regions) {
    regions.push(await diffRegion(job, region, referenceResized));
  }

  report.jobs.push({
    current: path.basename(job.current),
    name: job.name,
    reference: job.reference,
    regions,
  });
}

await writeFile(
  path.join(artifactsDir, "booking-region-diff-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(JSON.stringify(report, null, 2));

import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The build owns this list: source HTML cannot discover unloaded lazy chunks. */
export async function buildOfflineAssets(root = process.cwd(), outputDirectory = process.env.KINGPOS_BUILD_OUTPUT || ".next", sourceDeploymentId = process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_DEPLOYMENT_ID) {
  const rawId = sourceDeploymentId?.trim();
  const deploymentId = rawId && (rawId.length <= 32 ? rawId : /^[a-f0-9]{40}$/i.test(rawId) ? rawId.slice(0, 12) : rawId.slice(0, 32));
  if (deploymentId && !/^[A-Za-z0-9_-]{8,32}$/.test(deploymentId)) throw new Error("Invalid static asset deployment identifier.");
  const staticRoot = path.join(root, outputDirectory, "static");
  const records = [];
  async function walk(directory, prefix = "") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory()) await walk(path.join(directory, item.name), name + "/");
      else if (item.isFile() && !name.endsWith(".map")) {
        const bytes = await readFile(path.join(directory, item.name));
        records.push({ path: "/_next/static/" + name, bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await walk(staticRoot);
  records.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = records.reduce((total, row) => total + row.bytes, 0);
  if (!records.length || records.length > 600 || totalBytes > 48 * 1024 * 1024) {
    throw new Error("The complete offline application asset set exceeds its safe budget.");
  }
  const version = createHash("sha256").update(JSON.stringify({ deploymentId: deploymentId || null, files: records })).digest("hex");
  const result = { version, ...(deploymentId ? { deploymentId } : {}), assets: records.map(row => row.path), totalBytes, files: records };
  const destination = path.join(root, "public", "experience-build-assets.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination + ".tmp", JSON.stringify(result) + "\n");
  await rename(destination + ".tmp", destination);
  return { version, assets: records.length, totalBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await buildOfflineAssets()));
}

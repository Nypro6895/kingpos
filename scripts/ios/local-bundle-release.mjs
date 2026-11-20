import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packagePath = 'ios/Reylumi/LocalAppBundle';
const receiptPath = 'ios/build/local-bundle-provenance.json';
const mappingPaths = ['lib/app-local-commands-server.generated.ts', 'lib/app-local-command-trace-names.generated.json'];
const publicKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_MAPTILER_KEY', 'NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY'];
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => { if (!condition) throw Error(message); };
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));

function safePath(name) {
  check(typeof name === 'string' && name && !name.includes('\\') && !name.startsWith('/') && !name.includes(':') && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe package/source path');
  return name;
}

// Build products and journal records cannot become recursive source inputs.
function generated(name) {
  return /^(?:artifacts|releases|node_modules|ios\/build|ios\/Reylumi\.xcodeproj|ios\/Reylumi\.xcworkspace)(?:\/|$)/.test(name)
    || /^\.next(?:[-/]|$)/.test(name)
    || name === packagePath || name.startsWith(packagePath + '/')
    || mappingPaths.includes(name);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

function sourceSnapshot(root) {
  const products = ['artifacts', 'releases', 'node_modules', 'ios/build', 'ios/Reylumi.xcodeproj', 'ios/Reylumi.xcworkspace', packagePath, '.next*', ...mappingPaths];
  const extras = git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...products.map(name => ':(exclude)' + name)).split('\0').filter(Boolean);
  check(extras.length === 0, 'Untracked release inputs; stage/commit intended source before prepare: ' + extras.slice(0, 5).join(', '));
  const names = [...new Set(git(root, 'ls-files', '-z').split('\0').filter(Boolean).filter(name => !generated(name)))].sort();
  check(names.length > 0, 'No tracked release source');
  const files = names.map(name => {
    safePath(name);
    check(!name.split('/').some(part => part.startsWith('.env') && part !== '.env.example'), 'Private environment files must not be release inputs');
    const file = path.join(root, name);
    check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Missing or linked source input: ' + name);
    const raw = readFileSync(file);
    return { path: name, bytes: raw.length, sha256: hash(raw) };
  });
  return { commit: git(root, 'rev-parse', 'HEAD').trim(), sha256: hash(JSON.stringify(files)), files };
}

function packageSnapshot(directory) {
  const root = realpathSync(directory), manifest = readJSON(path.join(root, 'manifest.json'));
  check(manifest.productionReady === true && Array.isArray(manifest.files) && manifest.files.length > 0, 'Release requires an activated local bundle');
  check(Array.isArray(manifest.coverage?.missing) && manifest.coverage.missing.length === 0, 'Release bundle has incomplete route coverage');
  const expected = new Set(['manifest.json']);
  for (const row of manifest.files) {
    const name = safePath(row.path);
    check(!expected.has(name), 'Duplicate package resource: ' + name);
    expected.add(name);
    const file = path.join(root, name), relative = path.relative(root, realpathSync(file));
    check(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Linked or escaped package resource: ' + name);
    const raw = readFileSync(file);
    check(raw.length === row.bytes && hash(raw) === row.sha256, 'Bundled resource integrity mismatch: ' + name);
  }
  check(manifest.buildId === hash(JSON.stringify(manifest.files)), 'Bundle build ID does not match its resource inventory');
  const files = [];
  function visit(folder, prefix = '') {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      check(!entry.isSymbolicLink(), 'Linked package entry: ' + name);
      if (entry.isDirectory()) visit(path.join(folder, entry.name), name + '/');
      else {
        check(entry.isFile() && expected.has(name), 'Unmanifested package entry: ' + name);
        const raw = readFileSync(path.join(folder, entry.name));
        files.push({ path: name, bytes: raw.length, sha256: hash(raw) });
      }
    }
  }
  visit(root);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  check(files.length === expected.size, 'Package resources are missing');
  return { buildId: manifest.buildId, manifestSha256: hash(readFileSync(path.join(root, 'manifest.json'))), sha256: hash(JSON.stringify(files)), files };
}

function generatedMappings(root) {
  return mappingPaths.map(name => {
    const file = path.join(root, name);
    check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Missing or linked generated command mapping: ' + name);
    const raw = readFileSync(file);
    return { path: name, bytes: raw.length, sha256: hash(raw) };
  });
}

function cleanGeneratedBundle(root) {
  const absoluteRoot = realpathSync(root), target = path.resolve(absoluteRoot, packagePath);
  check(path.isAbsolute(target) && path.relative(absoluteRoot, target).split(path.sep).join('/') === packagePath, 'Unsafe generated bundle deletion target');
  let current = absoluteRoot;
  for (const part of packagePath.split('/')) {
    current = path.join(current, part);
    let info;
    try { info = lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    check(info.isDirectory() && !info.isSymbolicLink() && realpathSync(current) === current, 'Linked or unexpected generated bundle directory: ' + part);
  }
  // Only this exact verified generated directory can be removed; never a caller-selected path.
  rmSync(target, { recursive: true, force: true });
}

export function prepareBundle({ root = repository, env = process.env } = {}) {
  const receipt = path.join(root, receiptPath);
  rmSync(receipt, { force: true }); // A failed rebuild must never leave a usable old receipt.
  const before = sourceSnapshot(root);
  check(publicKeys.slice(0, 2).every(key => env[key]?.trim()), 'Bundle preparation requires the existing public Supabase URL and anon key');
  cleanGeneratedBundle(root);
  const generatedResult = spawnSync(process.execPath, ['scripts/build-app-local-bundle.mjs', '--activate'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  check(generatedResult.status === 0 && !generatedResult.error, 'Activated local bundle generation failed; no release receipt written');
  const after = sourceSnapshot(root);
  check(before.commit === after.commit && before.sha256 === after.sha256, 'Release source changed during bundle generation');
  const bundle = packageSnapshot(path.join(root, packagePath));
  const value = {
    schemaVersion: 1, createdAt: new Date().toISOString(), source: after, bundle, generatedMappings: generatedMappings(root),
    generator: { path: 'scripts/build-app-local-bundle.mjs', arguments: ['--activate'], servicesCatalogPilot: false },
    publicConfiguration: Object.fromEntries(publicKeys.map(key => [key, { present: Boolean(env[key]?.trim()), sha256: hash(env[key]?.trim() ?? '') }])),
  };
  mkdirSync(path.dirname(receipt), { recursive: true });
  writeFileSync(receipt, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return verifyBundle({ root });
}

export function verifyBundle({ root = repository, bundleDirectory = path.join(root, packagePath) } = {}) {
  const file = path.join(root, receiptPath);
  check(existsSync(file), 'Missing source-bound bundle receipt; run node scripts/ios/local-bundle-release.mjs prepare first');
  const value = readJSON(file);
  check(value.schemaVersion === 1 && value.generator?.path === 'scripts/build-app-local-bundle.mjs' && JSON.stringify(value.generator.arguments) === '["--activate"]' && value.generator.servicesCatalogPilot === false, 'Bundle receipt is not a production pilot-OFF preparation');
  const current = sourceSnapshot(root);
  check(current.commit === value.source?.commit && current.sha256 === value.source?.sha256 && JSON.stringify(current.files) === JSON.stringify(value.source.files), 'Stale bundle receipt: release source changed; regenerate before packaging');
  check(JSON.stringify(generatedMappings(root)) === JSON.stringify(value.generatedMappings), 'Generated command mappings changed after preparation');
  const bundled = packageSnapshot(bundleDirectory);
  check(JSON.stringify(bundled) === JSON.stringify(value.bundle), 'Bundle differs from the source-bound prepared package');
  // Also pin the checkout bundle when checking an archive/export, not just its copied bytes.
  if (path.resolve(bundleDirectory) !== path.resolve(root, packagePath)) {
    check(JSON.stringify(packageSnapshot(path.join(root, packagePath))) === JSON.stringify(value.bundle), 'Checkout bundle changed after preparation');
  }
  return { sourceCommit: current.commit, sourceSha256: current.sha256, sourceFiles: current.files.length, bundleBuildId: bundled.buildId, bundleManifestSha256: bundled.manifestSha256, bundleSha256: bundled.sha256, bundleFiles: bundled.files.length, servicesCatalogPilot: false, receipt: receiptPath, receiptSha256: hash(readFileSync(file)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, bundleDirectory, ...extra] = process.argv.slice(2);
    check(extra.length === 0 && (command === 'prepare' && !bundleDirectory || command === 'verify'), 'Usage: node scripts/ios/local-bundle-release.mjs prepare | verify [packaged-LocalAppBundle-directory]');
    console.log(JSON.stringify(command === 'prepare' ? prepareBundle() : verifyBundle({ bundleDirectory: bundleDirectory ? path.resolve(bundleDirectory) : undefined })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source inventory, not a binary scanner or an App Privacy certification.
// Review hits manually; this intentionally does not invent approved reasons.
export const categories = [
  ['UserDefaults', /\b(?:UserDefaults|NSUserDefaults|CFPreferences\w*)\b/],
  ['SystemBootTime', /\b(?:systemUptime|mach_absolute_time|clock_gettime_nsec_np)\b/],
  ['FileTimestamp', /\b(?:creationDateKey|contentModificationDateKey|creationDate|modificationDate|fileModificationDate|fileCreationDate|attributesOfItem|attributesOfFileSystem)\b|\b(?:stat|fstat|lstat|fstatat|getattrlist|fgetattrlist|getattrlistbulk)\s*\(/],
  ['DiskSpace', /\b(?:volumeAvailableCapacity\w*|volumeTotalCapacity\w*|systemFreeSize|systemSize)\b|\b(?:statfs|statvfs|fstatfs|fstatvfs)\s*\(/],
  ['ActiveKeyboards', /\bactiveInputModes\b/],
];
export function scanText(text) {
  return categories.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
export function inventory(root) {
  const native = join(root, 'ios/Reylumi');
  const sources = readdirSync(native, { recursive: true }).filter(path => /\.(swift|m|mm|c|cc|cpp|h)$/.test(path));
  const hits = [], imports = new Set(), sourceHashes = {};
  for (const path of sources.sort()) {
    const file = join(native, path), text = readFileSync(file, 'utf8');
    const name = relative(root, file).replaceAll('\\', '/');
    sourceHashes[name] = createHash('sha256').update(readFileSync(file)).digest('hex');
    text.split(/\r?\n/).forEach((line, index) => {
      // Skip full-line comments; strings and multiline comments still require manual review.
      if (/^\s*\/\//.test(line)) return;
      for (const category of scanText(line)) hits.push({ file: name, line: index + 1, category });
      const imported = line.match(/^\s*import\s+(\w+)/);
      if (imported) imports.add(imported[1]);
    });
  }
  const manifest = join(native, 'PrivacyInfo.xcprivacy');
  const text = existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
  const used = [...new Set(hits.map(hit => hit.category))].sort();
  // Declaration presence only. Validate the plist and actual reason semantics separately.
  const missingDeclarations = used.filter(name => !text.includes(`<string>NSPrivacyAccessedAPICategory${name}</string>`));
  return { sourceRoot: resolve(root), sources: sources.length, imports: [...imports].sort(), sourceHashes,
    requiredReasonHits: hits, usedCategories: used, manifestPresent: !!text, missingDeclarations,
    manifestSha256: text ? createHash('sha256').update(readFileSync(manifest)).digest('hex') : null,
    limitations: ['Heuristic source scan; not exhaustive SDK/binary analysis.', 'Declaration presence is not reason validation.',
      'No collection/tracking classification, provider configuration, archive resource, or legal approval is inferred.'] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inventory(resolve(process.argv[2] ?? '.'));
  console.log(JSON.stringify(result, null, 2));
  if (result.missingDeclarations.length) process.exitCode = 1;
}

// Exact ordered migration-byte identity shared by the isolated native QA tools.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { qualityMigration, sourceHash } from './explore-local-quality-native-bootstrap.mjs';

export const qualityMigrationFiles = [qualityMigration, '20261119052341_explore_local_quality_preparation.sql'];

export function readQualityMigrationBundle({ root = path.resolve('.'), inputFiles, archiveDirectory } = {}) {
  if (inputFiles && inputFiles.length !== qualityMigrationFiles.length) throw new Error('The complete ordered quality migration pair is required.');
  const entries = qualityMigrationFiles.map((name, index) => {
    const file = `supabase/migrations/${name}`, inputPath = path.resolve(root, inputFiles?.[index] ?? file);
    const bytes = readFileSync(inputPath), sql = bytes.toString('utf8'), sha256 = sourceHash(bytes);
    if (sourceHash(sql) !== sha256) throw new Error('Migration source is not lossless UTF-8.');
    let appliedPath = inputPath;
    if (archiveDirectory) {
      appliedPath = path.resolve(root, archiveDirectory, `${sha256}.sql`);
      mkdirSync(path.dirname(appliedPath), { recursive: true });
      if (existsSync(appliedPath)) {
        if (sourceHash(readFileSync(appliedPath)) !== sha256) throw new Error('Archived SQL does not match its filename hash; evidence must not be overwritten.');
      } else { writeFileSync(appliedPath, bytes, { flag: 'wx' }); chmodSync(appliedPath, 0o444); }
    }
    return { file, sha256, sql, inputPath, appliedPath };
  });
  const identity = entries.map(({ file, sha256 }) => ({ file, sha256 }));
  const identitySha256 = sourceHash(JSON.stringify(identity));
  const relative = file => path.relative(root, file).replaceAll('\\', '/');
  return {
    identitySha256,
    entries,
    receipt: { identityAlgorithm: 'sha256(JSON.stringify(ordered [{file,sha256},...]))', identitySha256,
      files: entries.map(({ file, sha256, inputPath, appliedPath }) => ({ file, sha256, inputSourceFile: relative(inputPath), appliedSourceFile: relative(appliedPath) })) },
    verifyArchivedBytes() {
      for (const entry of entries) if (sourceHash(readFileSync(entry.appliedPath)) !== entry.sha256) throw new Error('Frozen quality migration bytes changed; preserve partial evidence and restart after a new freeze.');
    },
  };
}

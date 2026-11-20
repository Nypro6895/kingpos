// Verify an explicitly accepted QA overlay without relabeling its original setup SQL.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sourceHash } from './explore-local-quality-native-bootstrap.mjs';
import { readQualityCatalog } from './explore-local-quality-catalog-fingerprint.mjs';

export async function verifyEffectiveQuality(db, marker, expectedIdentity) {
  const identity = marker.quality_effective_sha ?? marker.quality_sha;
  if (identity !== expectedIdentity) throw new Error('Effective native schema differs from the expected frozen migration pair.');
  if (!marker.quality_effective_sha) return { originalSetupIdentity: marker.quality_sha, effectiveIdentity: identity, mode: 'fresh_exact_pair' };
  const root = path.resolve('.'), proofPath = path.resolve(root, marker.quality_overlay_proof ?? '');
  const evidence = path.resolve(root, 'work/explore-local-quality-evidence') + path.sep;
  if (!proofPath.toLowerCase().startsWith(evidence.toLowerCase())) throw new Error('Compatibility receipt is outside the owned evidence directory.');
  const receipt = JSON.parse(readFileSync(proofPath, 'utf8')), proof = receipt.compatibilityProof;
  const database = (await db.query('SELECT current_database() AS name')).rows[0].name;
  if (!receipt.passed || !proof || !proof.projectionUnchanged || proof.database !== database || proof.scale !== marker.scale || proof.candidateIdentity !== identity || proof.originalSetupIdentity !== marker.quality_setup_sha || sourceHash(JSON.stringify(proof)) !== marker.quality_overlay_proof_sha || proof.catalogSha256 !== proof.freshCatalogSha256 || proof.catalogSha256 !== marker.quality_catalog_sha) throw new Error('Explicit compatible-schema receipt verification failed.');
  const catalog = await readQualityCatalog(db);
  if (catalog.sha256 !== marker.quality_catalog_sha) throw new Error('Current native function/index/ACL catalog no longer matches its fresh-schema proof.');
  return { originalSetupIdentity: marker.quality_setup_sha, effectiveIdentity: identity, mode: 'verified_compatible_overlay',
    compatibilityProof: proof, compatibilityProofFile: marker.quality_overlay_proof, compatibilityProofSha256: marker.quality_overlay_proof_sha, overlaySha256: marker.quality_overlay_sha, catalogSha256: catalog.sha256 };
}

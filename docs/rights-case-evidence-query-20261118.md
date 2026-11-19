# Case-bound evidence enumeration for the approved operator panel

Source-only query lane after the frozen `rights-image-evidence-backend-20261118` patch. The owner approved the operator preview rev2; this migration supplies its authenticated read contract without activating the evidence policy, assigning an operator or making a Storage request. The runtime/UI patch is separately owned and validated.

`get_admin_rights_case_evidence(p_case_id)` requires the existing canonical post-safety case and an active operator assigned to its linked Support/platform report with `admin.reports.read`. It returns only:

```ts
{
  caseId: string;
  policyEnabled: boolean;
  canCapture: boolean;
  blockedReason: null | 'permission' | 'policy_disabled' | 'special_safety' | 'unavailable';
  photos: Array<{
    objectId: string;
    evidenceId: string | null;
    state: RightsImageEvidenceState | null;
  }>;
}
```

Lock contention returns `null`; callers must fail closed. The opaque state `version` is a decision fingerprint, not an image checksum or Storage capability. No raw bucket/path, private key, URL, object version/eTag, SHA-256, author identity or image bytes are sent to the browser by this query. An object ID can be selected only through the separately checked capture RPC; it is not authority to fetch an arbitrary URL.

New candidates must belong to that exact case, have active upload authors, approved manifests, valid supported public-post paths and current Storage metadata matching all pinned fields. Legacy, missing, mismatched, fenced or foreign objects are excluded from **new capture**. Existing evidence rows are deliberately unioned back into the result, so status/private-copy access can survive origin removal, manifest erasure or private purge; those historical rows never re-enable capture. Source/private access still uses the original per-request permission, risk, policy and full-byte checks.

`canCapture` additionally requires update permission, enabled policy, an unrequested eligible candidate, an unexpired ordinary case deadline and no overdue hold. Current minor-safety flags and known same-object/exact-byte special-risk cases disable routine capture. A read-only assigned reviewer can see safe states with no decision authority. Membership revocation/reassignment takes effect on the next query. Hold editing and origin removal are separate from this enumeration; source uses are not detached, and Support close/reopen is not a removal decision.

The scoped isolated acceptance is `RUN_ISOLATED_SUPABASE=1 node --test tests/rights-case-evidence-query.integration.test.mjs`, with evidence under `artifacts/rights-case-evidence-query-20261118/acceptance`. It replays the actual full migration set and calls the authenticated PostgREST RPC with synthetic identities. Its image objects are explicitly **synthetic metadata**, because this query never reads bytes; the dependent 190100 acceptance separately exercises real local Storage upload/hash/private streaming/origin removal/purge and Auth erasure. The completion journal/frozen manifest records the exact query migration hash. No production, provider, email/SMS, deployment or Apple operation is part of these tests.

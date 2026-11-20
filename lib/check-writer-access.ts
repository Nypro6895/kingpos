type CheckWriterAccess = {
  paid_until?: string | null; payment_owner?: string | null;
  trial_ends_at?: string | null; trial_owner?: string | null;
};
export function checkWriterPaidActive(row: CheckWriterAccess | null | undefined, actor: string, now = Date.now()) {
  return Boolean(row && row.payment_owner === actor && Date.parse(row.paid_until ?? "") > now);
}
export function checkWriterAccessActive(row: CheckWriterAccess | null | undefined, actor: string, now = Date.now()) {
  return checkWriterPaidActive(row, actor, now)
    || Boolean(row && row.trial_owner === actor && Date.parse(row.trial_ends_at ?? "") > now);
}

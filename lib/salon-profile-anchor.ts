/** Post comments and verified salon experiences are different destinations. */
export function salonProfileAnchor(hash: string) {
  const value = hash.replace(/^#/, "");
  if (["lumi-trust", "lumi-trust-details"].includes(value)) return { targetId: "lumi-trust", expandTrust: true };
  if (["reviews", "customer-experiences", "feedback-good", "feedback-issue"].includes(value)) return { targetId: "customer-experiences", expandTrust: false };
  return null;
}

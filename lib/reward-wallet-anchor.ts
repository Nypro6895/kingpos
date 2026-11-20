/** A salon wallet anchor selects existing cards only; it carries no authority. */
export function rewardWalletSalonAnchor(hash: string): string | null {
  const match = /^#salon-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(hash);
  return match ? `salon-${match[1].toLowerCase()}` : null;
}

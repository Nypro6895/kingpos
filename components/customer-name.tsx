/** Keep the generic walk-in label secondary wherever a customer name is shown. */
export function CustomerName({
  name,
  fallback = "Walk-in Customer",
}: {
  name?: string | null;
  fallback?: string;
}) {
  const label = name?.trim() || fallback;
  const isWalkIn = /^walk[\s-]?in(?:\s+customer)?$/i.test(label);

  return isWalkIn ? (
    <span className="font-normal text-zinc-500">{label}</span>
  ) : (
    <>{label}</>
  );
}

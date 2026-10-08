import { AdminRetry } from "./retry";

export async function loadOptionalAdminSection<T>(load: () => Promise<T>) {
  try { return { data: await load(), error: null }; }
  catch (error) { return { data: null, error: error instanceof Error ? error.message : "This section could not load." }; }
}
export function SectionError({ message }: { message: string }) {
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}<AdminRetry/></div>;
}

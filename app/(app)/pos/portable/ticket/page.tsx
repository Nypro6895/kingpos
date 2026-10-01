import { getPortableTicketData } from "@/app/pos/portable/actions";
import { PortableTicketClient } from "@/app/pos/portable/ticket/portable-ticket-client";
export default async function PortableTicketPage({ searchParams }: {
  searchParams: Promise<{ date?: string; error?: string; q?: string }>;
}) {
  const { date, error, q } = await searchParams;
  const data = await getPortableTicketData(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  return <PortableTicketClient key={data.date + ":" + (q ?? "")} initialData={data} followToday={!(date && /^\d{4}-\d{2}-\d{2}$/.test(date))} error={error} searchQuery={q?.trim() ?? ""} />;
}

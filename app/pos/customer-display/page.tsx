import { CustomerDisplayClient } from "@/app/pos/customer-display/customer-display-client";

type CustomerDisplayPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function CustomerDisplayPage({
  searchParams,
}: CustomerDisplayPageProps) {
  const { token = "" } = await searchParams;

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-white">
      <CustomerDisplayClient token={token} />
    </main>
  );
}

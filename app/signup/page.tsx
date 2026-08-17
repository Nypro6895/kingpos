import { SignupForm } from "@/app/signup/signup-form";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import Link from "next/link";

type SignupPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { error, next } = await searchParams;
  const nextPath = sanitizeAuthReturnPath(next);

  return (
    <main className="relative z-10 mx-auto w-full max-w-md px-6 py-12 pointer-events-auto">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <SignupForm nextPath={nextPath} />

      <p className="mt-6 text-sm text-zinc-600">
        Already have an account?{" "}
        <Link
          className="font-medium text-zinc-950 underline"
          href={`/login?next=${encodeURIComponent(nextPath)}`}
        >
          Login
        </Link>
      </p>
    </main>
  );
}

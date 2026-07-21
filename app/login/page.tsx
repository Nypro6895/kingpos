import { LoginForm } from "@/app/login/login-form";
import Link from "next/link";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
  }>;
};

function getNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/account";
  }

  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message, next } = await searchParams;
  const nextPath = getNextPath(next);

  return (
    <main className="relative z-10 mx-auto w-full max-w-md px-6 py-12 pointer-events-auto">
      <h1 className="text-2xl font-semibold text-zinc-950">Login</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Sign in to access your KingPOS account.
      </p>

      {message ? (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <LoginForm nextPath={nextPath} />

      <p className="mt-6 text-sm text-zinc-600">
        No account yet?{" "}
        <Link
          className="font-medium text-zinc-950 underline"
          href={`/signup?next=${encodeURIComponent(nextPath)}`}
        >
          Create one
        </Link>
      </p>
    </main>
  );
}

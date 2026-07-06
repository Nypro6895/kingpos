import { SignupForm } from "@/app/signup/signup-form";
import Link from "next/link";

type SignupPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { error } = await searchParams;

  return (
    <main className="relative z-10 mx-auto w-full max-w-md px-6 py-12 pointer-events-auto">
      <h1 className="text-2xl font-semibold text-zinc-950">Create account</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Create your KingPOS login with Supabase Auth.
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <SignupForm />

      <p className="mt-6 text-sm text-zinc-600">
        Already have an account?{" "}
        <Link className="font-medium text-zinc-950 underline" href="/login">
          Login
        </Link>
      </p>
    </main>
  );
}

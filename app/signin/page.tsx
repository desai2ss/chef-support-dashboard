import { signIn } from "@/auth";

export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  const callbackUrl = searchParams.callbackUrl ?? "/";
  return (
    <main className="min-h-screen flex items-center justify-center bg-cream">
      <div className="bg-white border border-line rounded-lg p-8 max-w-sm w-full text-center">
        <h1 className="text-xl font-semibold mb-2">Chef Support Dashboard</h1>
        <p className="text-muted text-sm mb-6">
          Sign in with your <strong>@chefrobotics.ai</strong> Google account.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            className="w-full bg-ink text-white rounded-md py-2 text-sm font-medium"
          >
            Continue with Google
          </button>
        </form>
        <p className="text-xs text-muted mt-4">
          Access is restricted to approved domains.
        </p>
      </div>
    </main>
  );
}

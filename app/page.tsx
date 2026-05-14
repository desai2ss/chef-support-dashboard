import { auth, signOut } from "@/auth";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  // middleware already enforces auth, but check defensively
  if (!session?.user) return null;
  // @ts-expect-error session augmented in auth.ts
  const editor: boolean = !!session.user.isEditor;
  const email = session.user.email ?? "";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <header className="flex justify-between items-start mb-5">
        <div>
          <h1 className="text-2xl font-semibold">Chef Robotics — Support Dashboard</h1>
          <div className="text-muted text-xs mt-1">
            {today} · day-to-day metrics across Pylon, Datadog, BigQuery, and team input.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={"pill " + (editor ? "pill-live" : "pill-readonly")}>
            {editor ? "Editor" : "Read-only"}
          </span>
          <span className="text-xs text-muted">{email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="btn-secondary">Sign out</button>
          </form>
        </div>
      </header>

      <Dashboard editor={editor} />
    </main>
  );
}

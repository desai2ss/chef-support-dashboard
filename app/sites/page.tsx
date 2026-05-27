import { auth, signOut } from "@/auth";
import TopNav from "../components/TopNav";
import SitesView from "../components/SitesView";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const session = await auth();
  if (!session?.user) return null;
  // @ts-expect-error session augmented in auth.ts
  const editor: boolean = !!session.user.isEditor;
  const email = session.user.email ?? "";

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <header className="flex justify-between items-start mb-3">
        <div>
          <h1 className="text-2xl font-semibold">Chef Robotics — Support Dashboard</h1>
          <div className="text-muted text-xs mt-1">
            Site-level rollup · robots from BigQuery · tickets from Pylon · utilization from schedule
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

      <TopNav />

      <SitesView />
    </main>
  );
}

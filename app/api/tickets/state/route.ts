import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateIssueState } from "@/lib/pylon";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_STATES = new Set([
  "new",
  "waiting_on_you",
  "waiting_on_customer",
  "on_hold",
  "closed",
]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // @ts-expect-error session augmented in auth.ts
  if (!session.user.isEditor) {
    return NextResponse.json({ error: "forbidden — read-only" }, { status: 403 });
  }
  if (!process.env.PYLON_API_KEY) {
    return NextResponse.json(
      { error: "PYLON_API_KEY not set on server" },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const number = String(body.number ?? "").trim();
  const state = String(body.state ?? "").trim();
  if (!number) {
    return NextResponse.json({ error: "ticket number required" }, { status: 400 });
  }
  if (!ALLOWED_STATES.has(state)) {
    return NextResponse.json(
      { error: `state must be one of ${[...ALLOWED_STATES].join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await updateIssueState(number, state);
    return NextResponse.json({ ok: true, number, state });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Pylon update failed" },
      { status: 502 }
    );
  }
}

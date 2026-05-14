import { NextResponse } from "next/server";
import { auth, isEditor } from "@/auth";
import { db } from "@/lib/db";
import { dailyNotes, auditLog } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? todayKey();
  const [row] = await db.select().from(dailyNotes).where(eq(dailyNotes.date, date)).limit(1);
  return NextResponse.json({ note: row ?? { date, knownDownText: "", updatedAt: null, updatedBy: null } });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { date?: string; knownDownText?: string };
  const date = (body.date ?? todayKey()).trim();
  const text = String(body.knownDownText ?? "");
  const updatedBy = session.user.email ?? "";

  // Upsert via insert ... on conflict
  await db.insert(dailyNotes)
    .values({ date, knownDownText: text, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dailyNotes.date,
      set: { knownDownText: text, updatedBy, updatedAt: new Date() },
    });
  await db.insert(auditLog).values({
    actorEmail: updatedBy,
    action: "daily-note.update",
    entity: `daily-note:${date}`,
    payload: { length: text.length },
  });
  return NextResponse.json({ ok: true });
}

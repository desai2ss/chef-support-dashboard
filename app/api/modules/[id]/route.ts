import { NextResponse } from "next/server";
import { auth, isEditor } from "@/auth";
import { db } from "@/lib/db";
import { modules, auditLog } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["on-track", "at-risk", "blocked", "down"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; status?: string };
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    update.status = body.status;
  }
  const [row] = await db.update(modules).set(update).where(eq(modules.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.insert(auditLog).values({
    actorEmail: session.user.email ?? "",
    action: "module.update",
    entity: `module:${row.id}`,
    payload: update as Record<string, unknown>,
  });
  return NextResponse.json({ module: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [row] = await db.delete(modules).where(eq(modules.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.insert(auditLog).values({
    actorEmail: session.user.email ?? "",
    action: "module.delete",
    entity: `module:${row.id}`,
    payload: { name: row.name },
  });
  return NextResponse.json({ deleted: true });
}

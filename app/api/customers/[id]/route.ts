import { NextResponse } from "next/server";
import { auth, isEditor } from "@/auth";
import { db } from "@/lib/db";
import { customers, auditLog } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; weeklyHoursExpected?: number };
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (body.weeklyHoursExpected !== undefined)
    update.weeklyHoursExpected = Math.max(0, Math.floor(Number(body.weeklyHoursExpected)));

  const [row] = await db.update(customers).set(update).where(eq(customers.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.insert(auditLog).values({
    actorEmail: session.user.email ?? "",
    action: "customer.update",
    entity: `customer:${row.id}`,
    payload: update as Record<string, unknown>,
  });
  return NextResponse.json({ customer: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [row] = await db.delete(customers).where(eq(customers.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.insert(auditLog).values({
    actorEmail: session.user.email ?? "",
    action: "customer.delete",
    entity: `customer:${row.id}`,
    payload: { name: row.name },
  });
  return NextResponse.json({ deleted: true });
}

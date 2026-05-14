import { NextResponse } from "next/server";
import { auth, isEditor } from "@/auth";
import { db } from "@/lib/db";
import { customers, auditLog } from "@/lib/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(customers).orderBy(asc(customers.name));
  return NextResponse.json({ customers: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; weeklyHoursExpected?: number };
  const name = (body.name ?? "").trim();
  const weeklyHoursExpected = Math.max(0, Math.floor(Number(body.weeklyHoursExpected ?? 0)));
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const [row] = await db.insert(customers).values({ name, weeklyHoursExpected }).returning();
  await db.insert(auditLog).values({
    actorEmail: session.user.email ?? "",
    action: "customer.create",
    entity: `customer:${row.id}`,
    payload: { name, weeklyHoursExpected },
  });
  return NextResponse.json({ customer: row }, { status: 201 });
}

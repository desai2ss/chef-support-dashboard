import { NextResponse } from "next/server";
import { auth, isEditor } from "@/auth";
import { db } from "@/lib/db";
import { modules, auditLog } from "@/lib/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["on-track", "at-risk", "blocked", "down"]);

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(modules).orderBy(asc(modules.name));
  return NextResponse.json({ modules: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isEditor(session.user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    customerId?: string;
    name?: string;
    status?: string;
  };
  const customerId = (body.customerId ?? "").trim();
  const name = (body.name ?? "").trim();
  const status = (body.status ?? "on-track").trim();
  if (!customerId || !name) return NextResponse.json({ error: "customerId + name required" }, { status: 400 });
  if (!STATUSES.has(status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });

  const [row] = await db
    .insert(modules)
    .values({ customerId, name, status: status as any })
    .returning();
  await db.insert(auditLog).values({
    actorEmail: session.user.email ?? "",
    action: "module.create",
    entity: `module:${row.id}`,
    payload: { customerId, name, status },
  });
  return NextResponse.json({ module: row }, { status: 201 });
}

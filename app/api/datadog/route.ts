import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { datadogConfigured, fetchModuleHealth } from "@/lib/datadog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!datadogConfigured()) {
    return NextResponse.json({
      configured: false,
      message: "DATADOG_API_KEY / DATADOG_APP_KEY not set. Add them in Vercel env vars to enable this section.",
      modules: [],
    });
  }
  try {
    const modules = await fetchModuleHealth();
    return NextResponse.json({ configured: true, modules });
  } catch (e: any) {
    return NextResponse.json(
      { configured: true, error: e?.message ?? "Datadog request failed", modules: [] },
      { status: 502 }
    );
  }
}

import { refreshHistoryFromCron } from "@/lib/stockitup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = await refreshHistoryFromCron();
  return Response.json({
    backfillDone: store.backfillDone,
    backfillNextId: store.backfillNextId,
    openRefreshedAt: store.openRefreshedAt,
    days: Object.keys(store.days).length,
  });
}

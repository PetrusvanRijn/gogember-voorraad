import { Dashboard, DashboardError } from "@/components/Dashboard";
import { resolvePeriod } from "@/lib/config";
import { StockitupError, getDashboard } from "@/lib/stockitup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.periode) ? params.periode[0] : params.periode;
  const period = resolvePeriod(raw);

  try {
    const data = await getDashboard(period.days);
    return <Dashboard data={data} period={period} />;
  } catch (error) {
    console.error(error);
    const message = error instanceof StockitupError ? error.message : "De voorraad kon niet worden geladen.";
    return <DashboardError message={message} />;
  }
}

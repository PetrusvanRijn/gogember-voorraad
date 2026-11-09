import { PERIODS, RED_BELOW_DAYS, ORANGE_BELOW_DAYS, type Period } from "@/lib/config";
import { formatDayLabel, formatInt, formatOneDecimal, formatStock, formatTimestamp } from "@/lib/format";
import type { CaveatCode, Dashboard as DashboardData, Flag, StockRow } from "@/lib/metrics";
import { UsageChart } from "./Chart";
import { Logo } from "./Logo";

const FLAG_LABEL: Record<Flag, string> = {
  red: "Bestellen",
  orange: "Let op",
  ok: "Ruim",
  idle: "Geen verbruik",
  unknown: "Geen data",
};

const CAVEAT: Record<CaveatCode, string> = {
  "missing-line-detail":
    "De orderregels hebben geen SKU en geen aantal, alleen een status. Voorraad en pakketten kloppen. Verbruik van flessen, dozen en vakverdelingen kan pas berekend worden als die velden meekomen, of in live modus.",
  "partial-day": "De laatste dag loopt nog geen 18:00 in Johannesburg. Hij staat in de grafiek en telt niet mee in het gemiddelde.",
  "short-coverage": "De gekozen periode is langer dan de data die we hebben. Het gemiddelde gebruikt alleen dagen die echt in de dataset zitten, zonder de ontbrekende dagen als nul te tellen.",
  "tape-per-parcel": "Tape telt als 1 per verzonden pakket. Klopt de voorraad in rollen in plaats van per pakket, dan is de dekking niet bruikbaar.",
  "gember32-virtual":
    "StockItUp rekent de virtuele voorraad van Gember32 alsof het 32 flessen zijn. Verzonden flessen tellen we als 16, zoals de titel.",
  "canceled-with-label":
    "Sommige geannuleerde orders hebben toch een label en track & trace. Die pakketten tellen mee, want ze zijn verzonden.",
  "seller-not-listed": "Verkoper 38 staat niet in de lijst van deze API-sleutel. De oproep gaat toch naar verkoper 38.",
};

function coverText(row: StockRow): string {
  if (row.flag === "unknown") return "geen data";
  if (row.flag === "idle") return "geen verbruik";
  if (row.daysOfCover == null || !Number.isFinite(row.daysOfCover)) return "—";
  return formatOneDecimal(row.daysOfCover);
}

function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <table className="stock">
      <thead>
        <tr>
          <th>Artikel</th>
          <th className="num">Voorraad</th>
          <th className="num">Per dag</th>
          <th className="num">Dagen dekking</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={row.flag} data-testid={`row-${row.id}`}>
            <td>
              <span className="name">{row.label}</span>
              <span className="hint">{row.hint}</span>
            </td>
            <td className="num" data-label="Voorraad" data-testid={`stock-${row.id}`}>
              {row.stock == null ? "—" : formatStock(row.stock)}
            </td>
            <td className="num" data-label="Per dag" data-testid={`avg-${row.id}`}>
              {row.avgPerDay == null ? (
                "geen data"
              ) : (
                <>
                  {formatOneDecimal(row.avgPerDay)}
                  <small>
                    {formatInt(row.used ?? 0)} in de periode
                  </small>
                </>
              )}
            </td>
            <td className="num" data-label="Dagen dekking" data-testid={`cover-${row.id}`}>
              <span className={`flag ${row.flag}`}>
                <span className="pill">{FLAG_LABEL[row.flag]}</span>
                {row.flag === "red" || row.flag === "orange" || row.flag === "ok" ? coverText(row) : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Dashboard({ data, period }: { data: DashboardData; period: Period }) {
  const updated = data.stockUpdatedAt ?? data.fetchedAt;
  const chartTotal = data.days.reduce((sum, day) => sum + (data.chartUnit === "flessen" ? day.bottles ?? 0 : day.parcels ?? 0), 0);
  const unknown = data.unknown;

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <Logo />
          <div>
            <p className="eyebrow">Brandhouse Partners</p>
            <h1>Go Gember</h1>
            <p className="sub">Voorraad om te zien wanneer je moet bijbestellen.</p>
          </div>
        </div>
        <div className="stamp">
          <span>Bijgewerkt · Johannesburg</span>
          <strong data-testid="updated">{formatTimestamp(updated)}</strong>
          <span>
            {data.mode === "sample" ? "Voorbeelddata" : "Live"}
            {data.mode === "live" ? " · cache 15 min" : ""}
          </span>
          <form action="/api/logout" method="post">
            <button className="logout" type="submit">
              Afmelden
            </button>
          </form>
        </div>
      </header>

      <div className="toolbar">
        <nav className="segment" aria-label="Periode">
          {PERIODS.map((item) => (
            <a key={item.id} href={`/?periode=${item.id}`} aria-current={item.id === period.id ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="chips">
          <span className="chip">
            Gemiddelde <strong data-testid="window">{formatDayLabel(data.averageStart, false)} – {formatDayLabel(data.averageEnd, false)}</strong>
          </span>
          <span className="chip">
            <strong data-testid="averaged-days">{data.averagedDays}</strong> dagen
          </span>
          <span className="chip">
            Rood &lt; {RED_BELOW_DAYS} · oranje &lt; {ORANGE_BELOW_DAYS}
          </span>
        </div>
      </div>

      {data.caveats.includes("missing-line-detail") ? (
        <div className="banner" data-testid="line-detail-banner">
          <p>{CAVEAT["missing-line-detail"]}</p>
        </div>
      ) : null}

      <section className="panel">
        <header>
          <h2>Producten</h2>
          <p>Fysieke voorraad van de losse fles, het glas en de onderzetter.</p>
        </header>
        <StockTable rows={data.rows} />
      </section>

      <section className="panel">
        <header>
          <h2>Verpakking</h2>
          <p>Dozen en vakverdelingen volgen de doosregel. Tape is één per pakket.</p>
        </header>
        <StockTable rows={data.packaging} />
        {unknown ? (
          <p className="meta" data-testid="unknown-count">
            Onbekend in deze periode: {formatInt(unknown.total)}
            {unknown.total > 0
              ? ` (${formatInt(unknown.sku)} onbekende SKU, ${formatInt(unknown.over48)} meer dan 48 flessen, ${formatInt(unknown.ambiguous)} onduidelijk pakket). Die tellen niet mee voor dozen.`
              : "."}
          </p>
        ) : (
          <p className="meta" data-testid="unknown-count">
            Onbekend: niet te bepalen zonder SKU en aantal op de orderregel.
          </p>
        )}
      </section>

      <section className="panel">
        <header>
          <h2>Verzonden {data.chartUnit} per dag</h2>
          <p data-testid="chart-total">
            {formatInt(chartTotal)} in beeld
            {data.chartUnit === "pakketten" ? ` · ${formatInt(data.parcelsInAverage)} in het gemiddelde` : ""}
            {data.partialDate ? " · lichtere staaf is de lopende dag" : ""}
          </p>
        </header>
        <UsageChart days={data.days} unit={data.chartUnit} />
      </section>

      <details className="rules">
        <summary>Hoe dit wordt geteld</summary>
        <ul>
          {data.caveats
            .filter((code) => code !== "missing-line-detail")
            .map((code) => (
              <li key={code}>{CAVEAT[code]}</li>
            ))}
          <li>Voorraad is het veld OPSLAG van het losse artikel. Bundels zoals Gember5 tonen alleen een virtuele voorraad en staan hier niet als voorraad.</li>
          <li>De cijfers in een SKU kloppen niet altijd. Gember1 is 3 flessen, Gember32 is 16, Gember8 is 5+3. Shotglaasjes en onderzetters vullen geen vak.</li>
          <li>Doos: 1–6 flessen doos 6 vanaf 5 november 2026, en daarvoor doos 12. Daarna 7–12 doos 12, 13–30 doos 30, 31–48 doos 48. Eén vakverdeling per doos, zelfde maat.</li>
          <li>Orders met dezelfde pickorder of dezelfde track &amp; trace zijn één pakket. Een pakket telt bij een PDF-label én een track &amp; trace. De dag is het aanmaakmoment van het pakket in Johannesburg.</li>
          <li>Meer dan 48 flessen of een onbekende SKU gaat naar onbekend. Daar gokken we geen doos bij.</li>
          <li>Geen prijzen op dit scherm.</li>
        </ul>
      </details>
    </main>
  );
}

export function DashboardError({ message }: { message: string }) {
  return (
    <main className="shell">
      <section className="panel error-panel">
        <p className="eyebrow">Go Gember</p>
        <h1>Voorraad niet geladen</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

import { formatDayLabel, formatInt } from "@/lib/format";
import type { DayPoint } from "@/lib/metrics";

export function UsageChart({ days, unit }: { days: DayPoint[]; unit: "flessen" | "pakketten" }) {
  const values = days.map((day) => (unit === "flessen" ? day.bottles : day.parcels));
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const width = 720;
  const height = 168;
  const padTop = 12;
  const padBottom = 8;
  const gap = days.length > 40 ? 2 : 6;
  const innerWidth = width - 8;
  const barWidth = (innerWidth - gap * (days.length - 1)) / Math.max(days.length, 1);
  const labelEvery = days.length <= 8 ? 1 : days.length <= 32 ? 4 : 14;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Verzonden ${unit} per dag`}>
        <title>{`Verzonden ${unit} per dag`}</title>
        {[0.5, 1].map((step) => (
          <line
            key={step}
            x1="0"
            x2={width}
            y1={padTop + (1 - step) * (height - padTop - padBottom)}
            y2={padTop + (1 - step) * (height - padTop - padBottom)}
            stroke="rgba(235,226,215,0.12)"
          />
        ))}
        {days.map((day, index) => {
          const value = unit === "flessen" ? day.bottles : day.parcels;
          const barHeight = value == null ? 0 : (value / max) * (height - padTop - padBottom);
          const x = 4 + index * (barWidth + gap);
          const y = height - padBottom - barHeight;
          return (
            <g key={day.date}>
              {value != null && value > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={Math.max(barWidth, 1)}
                  height={barHeight}
                  rx={barWidth > 8 ? 3 : 1}
                  fill={day.partial ? "#efaf55" : "#c9a06a"}
                  opacity={day.partial ? 0.55 : day.inAverage ? 1 : 0.45}
                >
                  <title>{`${formatDayLabel(day.date, true)}: ${formatInt(value)} ${unit}${day.partial ? " (lopende dag)" : ""}`}</title>
                </rect>
              ) : (
                <rect x={x} y={height - padBottom - 2} width={Math.max(barWidth, 1)} height={2} fill="rgba(235,226,215,0.18)">
                  <title>{`${formatDayLabel(day.date, true)}: ${value == null ? "geen data" : "0"}`}</title>
                </rect>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-labels">
        {days.map((day, index) => (
          <span key={day.date} style={{ visibility: index % labelEvery === 0 || day.partial ? "visible" : "hidden" }}>
            {formatDayLabel(day.date, days.length <= 8)}
            {day.partial ? " · nu" : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{`Verzonden ${unit} per dag`}</caption>
        <thead>
          <tr>
            <th>Dag</th>
            <th>{unit === "flessen" ? "Flessen" : "Pakketten"}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const value = unit === "flessen" ? day.bottles : day.parcels;
            return (
              <tr key={day.date}>
                <td>{formatDayLabel(day.date, true)}</td>
                <td>{value == null ? "geen data" : formatInt(value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

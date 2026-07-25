import type { ReportSeriesPoint } from "../types/domain";

interface MiniLineChartProps {
  series: ReportSeriesPoint[];
  emptyText?: string;
}

export function MiniLineChart({
  series,
  emptyText = "Todavía no existen datos para mostrar.",
}: MiniLineChartProps) {
  const hasData = series.some((point) => point.value > 0);
  if (!series.length || !hasData) {
    return <div className="chart-empty-state">{emptyText}</div>;
  }

  const width = 760;
  const height = 230;
  const padding = { top: 22, right: 18, bottom: 42, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(...series.map((point) => point.value), 1);

  const x = (index: number) =>
    padding.left +
    (series.length === 1
      ? plotWidth / 2
      : (index / (series.length - 1)) * plotWidth);
  const y = (value: number) =>
    padding.top + plotHeight - (value / maximum) * plotHeight;

  const points = series
    .map((point, index) => `${x(index)},${y(point.value)}`)
    .join(" ");
  const area = `${padding.left},${padding.top + plotHeight} ${points} ${
    padding.left + plotWidth
  },${padding.top + plotHeight}`;

  return (
    <div className="mini-chart-scroll">
      <svg
        className="mini-line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Evolución de ventas"
      >
        <defs>
          <linearGradient id="miniChartArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff7a00" stopOpacity=".27" />
            <stop offset="100%" stopColor="#ff7a00" stopOpacity=".02" />
          </linearGradient>
        </defs>

        {[0, 1, 2, 3, 4].map((step) => {
          const lineY = padding.top + (plotHeight / 4) * step;
          return (
            <line
              key={step}
              x1={padding.left}
              x2={padding.left + plotWidth}
              y1={lineY}
              y2={lineY}
              className="mini-chart-grid"
            />
          );
        })}

        <polygon points={area} fill="url(#miniChartArea)" />
        <polyline points={points} className="mini-chart-line" />

        {series.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle
              cx={x(index)}
              cy={y(point.value)}
              r={4}
              className="mini-chart-dot"
            >
              <title>
                {point.label}: S/ {point.value.toFixed(2)}
              </title>
            </circle>
            <text
              x={x(index)}
              y={height - 16}
              textAnchor="middle"
              className="mini-chart-label"
            >
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

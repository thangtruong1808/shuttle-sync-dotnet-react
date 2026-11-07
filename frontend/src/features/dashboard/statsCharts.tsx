import { useId, useState, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { safeNumber } from "./dashboardStatsApi";

export type ChartSeriesPoint = {
  index: number;
  key: string;
  label: string;
  shortLabel: string;
  current: number;
  previous: number | null;
  previousLabel: string | null;
  secondaryCurrent?: number;
  metaText?: string;
};

export function InlineChartEmpty({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-inset/60 px-4 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent-text">
        {icon ?? <BarChart3 className="h-5 w-5" aria-hidden="true" />}
      </span>
      <p className="mt-3 text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-muted">{description}</p>
    </div>
  );
}

function niceCeiling(maxValue: number): number {
  const safe = safeNumber(maxValue, 0);
  if (safe <= 0) return 10;
  if (safe <= 5) return 5;
  if (safe <= 10) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(safe)));
  const normalized = safe / magnitude;
  if (normalized <= 1.2) return 1.2 * magnitude;
  if (normalized <= 1.5) return 1.5 * magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 2.5) return 2.5 * magnitude;
  if (normalized <= 3) return 3 * magnitude;
  if (normalized <= 4) return 4 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  if (normalized <= 6) return 6 * magnitude;
  if (normalized <= 8) return 8 * magnitude;
  return 10 * magnitude;
}

function shouldShowXLabel(index: number, total: number): boolean {
  if (total <= 8) return true;
  if (total <= 14) return index % 2 === 0 || index === total - 1;
  return index === 0 || index % 5 === 0 || index === total - 1;
}

function resolveActiveIndex(points: ChartSeriesPoint[], selectedKey: string | null): number {
  if (points.length === 0) return 0;
  if (selectedKey) {
    const found = points.findIndex((p) => p.key === selectedKey);
    if (found >= 0) return found;
  }
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].current > 0) return i;
  }
  return 0;
}

function ChartInspectorBar({
  activePoint,
  showPrevious,
  formatValue,
  isBar,
}: {
  activePoint: ChartSeriesPoint | null;
  showPrevious: boolean;
  formatValue: (val: number) => string;
  isBar?: boolean;
}) {
  if (!activePoint) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-inset px-3.5 py-2.5 text-xs"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-fg">{activePoint.label}</span>
        {activePoint.metaText ? <span className="text-fg-muted">· {activePoint.metaText}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 tabular-nums">
        <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
          <span
            className={`h-2.5 w-2.5 bg-accent ${isBar ? "rounded-sm" : "rounded-full"}`}
            aria-hidden="true"
          />
          {formatValue(activePoint.current)}
        </span>
        {showPrevious && activePoint.previous !== null ? (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            {isBar ? (
              <span className="h-2.5 w-2.5 rounded-sm bg-fg/25" aria-hidden="true" />
            ) : (
              <span className="h-0.5 w-3 border-t-2 border-dashed border-fg-muted" aria-hidden="true" />
            )}
            Prior{activePoint.previousLabel ? ` (${activePoint.previousLabel})` : ""}:{" "}
            <strong className="font-medium text-fg">{formatValue(activePoint.previous)}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChartLegendBar({
  currentLegendLabel,
  showPrevious,
  previousLegendLabel,
  isBar,
}: {
  currentLegendLabel: string;
  showPrevious: boolean;
  previousLegendLabel?: string;
  isBar?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 bg-accent ring-1 ring-accent-text ${isBar ? "rounded-sm" : "rounded-full"}`}
            aria-hidden="true"
          />
          <span>{currentLegendLabel}</span>
        </span>
        {showPrevious && previousLegendLabel ? (
          <span className="inline-flex items-center gap-1.5">
            {isBar ? (
              <span className="h-2.5 w-2.5 rounded-sm bg-fg-muted/35" aria-hidden="true" />
            ) : (
              <span className="h-0.5 w-3.5 border-t-2 border-dashed border-fg-muted" aria-hidden="true" />
            )}
            <span>{previousLegendLabel}</span>
          </span>
        ) : null}
      </div>
      <span className="text-[11px] text-fg-muted/80">
        Tap or hover any {isBar ? "bar" : "point"} to inspect
      </span>
    </div>
  );
}

export function TrendAreaChart({
  points,
  showPrevious,
  formatValue,
  formatAxisValue,
  currentLegendLabel,
  previousLegendLabel,
  ariaLabel,
}: {
  points: ChartSeriesPoint[];
  showPrevious: boolean;
  formatValue: (val: number) => string;
  formatAxisValue?: (val: number) => string;
  currentLegendLabel: string;
  previousLegendLabel?: string;
  ariaLabel: string;
}) {
  const gradId = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const safeIdx = resolveActiveIndex(points, selectedKey);
  const activePoint = points[safeIdx] ?? null;

  const maxRaw = points.reduce((acc, p) => {
    const cur = safeNumber(p.current);
    const prev = showPrevious && p.previous !== null ? safeNumber(p.previous) : 0;
    return Math.max(acc, cur, prev);
  }, 0);

  const ceiling = niceCeiling(maxRaw);
  const ticks = [0, ceiling * 0.25, ceiling * 0.5, ceiling * 0.75, ceiling];

  const width = 680;
  const height = 230;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  function xFor(idx: number): number {
    if (points.length <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (points.length - 1)) * plotW;
  }

  function yFor(val: number): number {
    const clamped = Math.max(0, Math.min(ceiling, safeNumber(val)));
    return padTop + plotH - (clamped / ceiling) * plotH;
  }

  const currentCoords = points.map((p, idx) => ({ x: xFor(idx), y: yFor(p.current) }));
  const linePath = currentCoords
    .map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    currentCoords.length > 0
      ? `${linePath} L${currentCoords[currentCoords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} L${currentCoords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : "";

  const prevCoords = showPrevious
    ? points
        .map((p, idx) => (p.previous !== null ? { x: xFor(idx), y: yFor(p.previous) } : null))
        .filter((pt): pt is { x: number; y: number } => pt !== null)
    : [];
  const prevLinePath = prevCoords
    .map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(" ");

  const axisFormat = formatAxisValue ?? formatValue;

  return (
    <div className="space-y-3">
      <ChartInspectorBar
        activePoint={activePoint}
        showPrevious={showPrevious}
        formatValue={formatValue}
      />

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full select-none overflow-visible sm:h-64"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((tick, idx) => {
            const y = yFor(tick);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="rgb(var(--border))"
                  strokeDasharray={idx === 0 ? undefined : "3 3"}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-fg-muted text-[10px] tabular-nums"
                >
                  {axisFormat(tick)}
                </text>
              </g>
            );
          })}

          {areaPath ? <path d={areaPath} fill={`url(#${gradId})`} /> : null}

          {showPrevious && prevLinePath ? (
            <path
              d={prevLinePath}
              fill="none"
              stroke="rgb(var(--fg-muted))"
              strokeOpacity="0.65"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
          ) : null}

          {linePath ? (
            <path
              d={linePath}
              fill="none"
              stroke="rgb(var(--accent-text))"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {currentCoords[safeIdx] ? (
            <line
              x1={currentCoords[safeIdx].x}
              y1={padTop}
              x2={currentCoords[safeIdx].x}
              y2={padTop + plotH}
              stroke="rgb(var(--accent-text))"
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          ) : null}

          {points.map((pt, idx) => {
            const cx = xFor(idx);
            const cy = yFor(pt.current);
            const isSelected = idx === safeIdx;
            const slotWidth = points.length > 1 ? plotW / points.length : plotW;
            return (
              <g key={pt.key}>
                {showPrevious && pt.previous !== null ? (
                  <circle
                    cx={cx}
                    cy={yFor(pt.previous)}
                    r={isSelected ? 4 : 2.2}
                    fill="rgb(var(--surface))"
                    stroke="rgb(var(--fg-muted))"
                    strokeWidth="1.5"
                  />
                ) : null}

                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5 : points.length > 20 ? 2.5 : 3.5}
                  fill={isSelected ? "rgb(var(--accent))" : "rgb(var(--surface))"}
                  stroke="rgb(var(--accent-text))"
                  strokeWidth={isSelected ? "2.5" : "2"}
                />

                {shouldShowXLabel(idx, points.length) ? (
                  <text
                    x={cx}
                    y={height - 8}
                    textAnchor="middle"
                    className={`text-[10px] tabular-nums ${
                      isSelected ? "fill-fg font-semibold" : "fill-fg-muted"
                    }`}
                  >
                    {pt.shortLabel}
                  </text>
                ) : null}

                <rect
                  x={cx - slotWidth / 2}
                  y={padTop}
                  width={Math.max(12, slotWidth)}
                  height={plotH + 22}
                  fill="transparent"
                  className="cursor-pointer outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${pt.label}: ${formatValue(pt.current)}`}
                  onMouseEnter={() => setSelectedKey(pt.key)}
                  onClick={() => setSelectedKey(pt.key)}
                  onFocus={() => setSelectedKey(pt.key)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <ChartLegendBar
        currentLegendLabel={currentLegendLabel}
        showPrevious={showPrevious}
        previousLegendLabel={previousLegendLabel}
      />
    </div>
  );
}

export function TrendBarChart({
  points,
  showPrevious,
  formatValue,
  formatAxisValue,
  currentLegendLabel,
  previousLegendLabel,
  ariaLabel,
}: {
  points: ChartSeriesPoint[];
  showPrevious: boolean;
  formatValue: (val: number) => string;
  formatAxisValue?: (val: number) => string;
  currentLegendLabel: string;
  previousLegendLabel?: string;
  ariaLabel: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const safeIdx = resolveActiveIndex(points, selectedKey);
  const activePoint = points[safeIdx] ?? null;

  const maxRaw = points.reduce((acc, p) => {
    const cur = safeNumber(p.current);
    const prev = showPrevious && p.previous !== null ? safeNumber(p.previous) : 0;
    return Math.max(acc, cur, prev);
  }, 0);

  const ceiling = niceCeiling(maxRaw);
  const ticks = [0, ceiling * 0.25, ceiling * 0.5, ceiling * 0.75, ceiling];

  const width = 680;
  const height = 230;
  const padLeft = 46;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const baselineY = padTop + plotH;

  function yFor(val: number): number {
    const clamped = Math.max(0, Math.min(ceiling, safeNumber(val)));
    return padTop + plotH - (clamped / ceiling) * plotH;
  }

  const count = Math.max(1, points.length);
  const groupWidth = plotW / count;
  const barWidth = showPrevious
    ? Math.max(3, Math.min(18, groupWidth * 0.34))
    : Math.max(4, Math.min(28, groupWidth * 0.58));

  const axisFormat = formatAxisValue ?? formatValue;

  return (
    <div className="space-y-3">
      <ChartInspectorBar
        activePoint={activePoint}
        showPrevious={showPrevious}
        formatValue={formatValue}
        isBar
      />

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full select-none overflow-visible sm:h-64"
          role="img"
          aria-label={ariaLabel}
        >
          {ticks.map((tick, idx) => {
            const y = yFor(tick);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="rgb(var(--border))"
                  strokeDasharray={idx === 0 ? undefined : "3 3"}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-fg-muted text-[10px] tabular-nums"
                >
                  {axisFormat(tick)}
                </text>
              </g>
            );
          })}

          {points.map((pt, idx) => {
            const centerX = padLeft + idx * groupWidth + groupWidth / 2;
            const curY = yFor(pt.current);
            const curH = Math.max(0, baselineY - curY);
            const isSelected = idx === safeIdx;

            const prevVal = showPrevious && pt.previous !== null ? pt.previous : null;
            const prevY = prevVal !== null ? yFor(prevVal) : baselineY;
            const prevH = prevVal !== null ? Math.max(0, baselineY - prevY) : 0;

            const curX = showPrevious && prevVal !== null ? centerX + 1 : centerX - barWidth / 2;
            const prevX = centerX - barWidth - 1;

            return (
              <g key={pt.key}>
                {isSelected ? (
                  <rect
                    x={padLeft + idx * groupWidth + 1}
                    y={padTop}
                    width={Math.max(4, groupWidth - 2)}
                    height={plotH}
                    rx="4"
                    fill="rgb(var(--fg))"
                    fillOpacity="0.05"
                  />
                ) : null}

                {showPrevious && prevVal !== null && prevH > 0 ? (
                  <rect
                    x={prevX}
                    y={prevY}
                    width={barWidth}
                    height={prevH}
                    rx="2.5"
                    fill="rgb(var(--fg-muted))"
                    fillOpacity={isSelected ? "0.45" : "0.28"}
                  />
                ) : null}

                {curH > 0 ? (
                  <rect
                    x={curX}
                    y={curY}
                    width={barWidth}
                    height={curH}
                    rx="2.5"
                    fill="rgb(var(--accent))"
                    fillOpacity={isSelected ? "1" : "0.82"}
                    stroke="rgb(var(--accent-text))"
                    strokeWidth={isSelected ? "1.2" : "0.5"}
                  />
                ) : null}

                {shouldShowXLabel(idx, points.length) ? (
                  <text
                    x={centerX}
                    y={height - 8}
                    textAnchor="middle"
                    className={`text-[10px] tabular-nums ${
                      isSelected ? "fill-fg font-semibold" : "fill-fg-muted"
                    }`}
                  >
                    {pt.shortLabel}
                  </text>
                ) : null}

                <rect
                  x={padLeft + idx * groupWidth}
                  y={padTop}
                  width={Math.max(10, groupWidth)}
                  height={plotH + 22}
                  fill="transparent"
                  className="cursor-pointer outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${pt.label}: ${formatValue(pt.current)}`}
                  onMouseEnter={() => setSelectedKey(pt.key)}
                  onClick={() => setSelectedKey(pt.key)}
                  onFocus={() => setSelectedKey(pt.key)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <ChartLegendBar
        currentLegendLabel={currentLegendLabel}
        showPrevious={showPrevious}
        previousLegendLabel={previousLegendLabel}
        isBar
      />
    </div>
  );
}


"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { formatSleepPeriodLabel, totalSleepMinutes, type SleepDay } from "@/lib/sleep";
import { smoothPath, type Pt, zoomDomain, type ChartDomain } from "@/lib/chart";

const STAGES = [
  { key: "coreMinutes", label: "Core", color: "rgb(96 165 250)" },
  { key: "deepMinutes", label: "Deep", color: "rgb(99 102 241)" },
  { key: "remMinutes", label: "REM", color: "rgb(192 132 252)" },
  { key: "unspecifiedMinutes", label: "Unspecified", color: "rgb(148 163 184)" },
  { key: "awakeMinutes", label: "Awake", color: "rgb(251 191 36)" },
] as const;

const STACKED_STAGES = [STAGES[0], STAGES[1], STAGES[2], STAGES[3], STAGES[4]] as const;
const WHEEL_ZOOM = 1.15;
const MIN_ZOOM_POINTS = 3;

function hoursAndMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}


export function SleepHistoryChart({
  nights,
  interval,
}: {
  nights: SleepDay[];
  interval: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [domain, setDomain] = useState<ChartDomain>([0, Math.max(1, nights.length - 1)]);

  const displayNights = [...nights].reverse();
  const fullMax = Math.max(0, displayNights.length - 1);
  const domainKey = `${interval}:${displayNights.length}`;
  const initialDomain: ChartDomain = [0, Math.max(1, fullMax)];
  const [domainKeyState, setDomainKeyState] = useState(domainKey);
  const effectiveDomain = domainKeyState === domainKey ? domain : initialDomain;
  const isZoomed = effectiveDomain[0] > 0.01 || effectiveDomain[1] < fullMax - 0.01;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    setWidth(Math.max(320, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const visibleStart = displayNights.length ? Math.max(0, Math.floor(effectiveDomain[0])) : 0;
  const visibleEnd = displayNights.length
    ? Math.min(displayNights.length - 1, Math.ceil(effectiveDomain[1]))
    : -1;
  const visibleNights = displayNights.slice(visibleStart, visibleEnd + 1);

  const maxMinutes = Math.max(
    1,
    ...visibleNights.map((night) =>
      Math.max(
        night.inBedMinutes,
        night.asleepMinutes + night.awakeMinutes,
        night.coreMinutes +
          night.deepMinutes +
          night.remMinutes +
          night.unspecifiedMinutes +
          night.awakeMinutes,
      ),
    ),
  );
  const axisMax = Math.max(8 * 60, Math.ceil(maxMinutes / 60) * 60);
  const axisStep = axisMax >= 12 * 60 ? 3 * 60 : 2 * 60;
  const ticks = Array.from(
    { length: Math.floor(axisMax / axisStep) + 1 },
    (_, index) => index * axisStep,
  ).filter((minutes) => minutes <= axisMax);
  const chartHeight = 260;
  const barInset = visibleNights.length > 90 ? 1 : visibleNights.length > 30 ? 2 : 3;
  const labelCount = Math.min(6, visibleNights.length);
  const labelStep = Math.max(
    1,
    Math.ceil(Math.max(0, visibleNights.length - 1) / Math.max(1, labelCount - 1)),
  );
  const labelIndexes = new Set<number>();
  for (let i = 0; i < visibleNights.length; i += labelStep) labelIndexes.add(i);
  if (visibleNights.length) labelIndexes.add(visibleNights.length - 1);

  const linePoints: Pt[] = visibleNights.map((night, index) => {
    const x = ((index + 0.5) / Math.max(1, visibleNights.length)) * width;
    const y = chartHeight - (Math.min(axisMax, Math.max(0, totalSleepMinutes(night))) / axisMax) * chartHeight;
    return [x, y];
  });

  function indexAtClientX(clientX: number) {
    const el = chartRef.current;
    if (!el || !displayNights.length) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const visibleIndex = Math.max(
      0,
      Math.min(visibleNights.length - 1, Math.floor((x / Math.max(1, rect.width)) * visibleNights.length)),
    );
    return visibleStart + visibleIndex;
  }

  function applyWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!displayNights.length) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const center =
      effectiveDomain[0] +
      (x / Math.max(1, rect.width)) * (effectiveDomain[1] - effectiveDomain[0]);
    const factor = e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM;
    setDomainKeyState(domainKey);
    setDomain((current) =>
      zoomDomain(current, center, factor, 0, fullMax, MIN_ZOOM_POINTS),
    );
    setHover(indexAtClientX(e.clientX));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setHover(indexAtClientX(e.clientX));
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    setHover(indexAtClientX(e.clientX));
  }

  function onDoubleClick() {
    setDomainKeyState(domainKey);
    setDomain([0, Math.max(1, fullMax)]);
    setHover(null);
  }

  const hoverVisibleIndex =
    hover != null && hover >= visibleStart && hover <= visibleEnd
      ? hover - visibleStart
      : null;
  const hoverNight = hover != null ? displayNights[hover] : null;
  const hoverX =
    hoverVisibleIndex != null
      ? ((hoverVisibleIndex + 0.5) / Math.max(1, visibleNights.length)) * 100
      : 0;
  const hoverY =
    hoverNight != null
      ? (chartHeight - (Math.min(axisMax, Math.max(0, totalSleepMinutes(hoverNight))) / axisMax) * chartHeight)
      : 0;

  return (
    <section className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--muted)" }}>History</div>
          <h2 style={{ margin: "5px 0 0", fontSize: 20 }}>Sleep stages</h2>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
            {nights.some((night) => (night.nights ?? 1) > 1)
              ? "Each bar is the average night for its time bucket, stacked by stage duration."
              : "Each bar is one night, stacked by stage duration."}
          </div>
        </div>
        <div style={{ color: "var(--faint)", fontSize: 12 }}>
          {displayNights.reduce((sum, night) => sum + (night.nights ?? 1), 0)} nights
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 18, color: "var(--muted)", fontSize: 12 }}>
        {STAGES.map((stage) => (
          <div key={stage.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: stage.color }} />
            {stage.label}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden="true" style={{ width: 14, height: 2, borderRadius: 2, background: "#5e5ce6" }} />
          Total sleep
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0, 1fr)", gap: 10, marginTop: 18 }}>
        <div style={{ position: "relative", height: chartHeight, color: "var(--faint)", fontSize: 10 }}>
          {ticks.map((minutes) => (
            <span
              key={minutes}
              style={{
                position: "absolute",
                right: 0,
                bottom: `${(minutes / axisMax) * 100}%`,
                transform: "translateY(50%)",
              }}
            >
              {minutes / 60}h
            </span>
          ))}
        </div>

        <div
          ref={wrapRef}
          style={{ minWidth: 0, width: "100%", position: "relative" }}
          onWheel={applyWheel}
          onDoubleClick={onDoubleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          onPointerCancel={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          onPointerLeave={() => setHover(null)}
        >
          <div
            ref={chartRef}
            style={{
              width: "100%",
              paddingBottom: 2,
              position: "relative",
              touchAction: "none",
              cursor: isZoomed ? "crosshair" : "default",
            }}
          >
            {isZoomed && (
              <div style={{ display: "flex", justifyContent: "flex-end", minHeight: 24, marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDomainKeyState(domainKey);
                    setDomain([0, Math.max(1, fullMax)]);
                    setHover(null);
                  }}
                  aria-label="Reset chart zoom"
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6 }}
                >
                  Reset zoom
                </button>
              </div>
            )}

            <div
              style={{
                position: "relative",
                height: chartHeight,
                display: "flex",
                alignItems: "flex-end",
                padding: "0 2px",
                backgroundImage: `linear-gradient(to top, transparent calc(100% - 1px), var(--border) calc(100% - 1px))`,
                backgroundSize: `100% ${(axisStep / axisMax) * 100}%`,
              }}
            >
              {visibleNights.length > 0 && (
                <svg
                  aria-label="Total sleep duration trend"
                  role="img"
                  viewBox={`0 0 ${width} ${chartHeight}`}
                  preserveAspectRatio="none"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    overflow: "visible",
                    zIndex: 2,
                  }}
                >
                  <path
                    className="fadein"
                    fill="none"
                    stroke="#5e5ce6"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={smoothPath(linePoints, 0.55)}
                  />
                  {visibleNights.map((night, index) => {
                    const point = linePoints[index];
                    return (
                      <circle
                        key={night.date}
                        cx={point[0]}
                        cy={point[1]}
                        r={hoverVisibleIndex === index ? 4.5 : 2.5}
                        fill="var(--fg)"
                        stroke="var(--bg)"
                        strokeWidth={hoverVisibleIndex === index ? 2 : 1}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                  {hoverVisibleIndex != null && (
                    <line
                      x1={linePoints[hoverVisibleIndex][0]}
                      y1={0}
                      x2={linePoints[hoverVisibleIndex][0]}
                      y2={chartHeight}
                      stroke="var(--border-strong)"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
              )}

              {visibleNights.map((night) => {
                const inBed = Math.max(0, night.inBedMinutes);
                const stageTotal =
                  night.coreMinutes +
                  night.deepMinutes +
                  night.remMinutes +
                  night.unspecifiedMinutes +
                  night.awakeMinutes;
                const total = Math.max(inBed, stageTotal);
                const barHeight = (Math.min(axisMax, total) / axisMax) * chartHeight;

                return (
                  <div
                    key={night.date}
                    style={{
                      width: 0,
                      height: Math.max(2, barHeight),
                      flex: "1 1 0",
                      minWidth: 2,
                      padding: `0 ${barInset}px`,
                      boxSizing: "border-box",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      overflow: "visible",
                    }}
                  >
                    <div
                      title={`${formatSleepPeriodLabel(night.date, interval)} · ${night.nights ?? 1} ${(night.nights ?? 1) === 1 ? "night" : "nights"} · ${hoursAndMinutes(night.asleepMinutes)} asleep · ${hoursAndMinutes(night.inBedMinutes)} in bed`}
                      style={{
                        width: "100%",
                        height: "100%",
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: "5px 5px 2px 2px",
                        background: "var(--border)",
                      }}
                    >
                      {STACKED_STAGES.map((stage, stageIndex) => {
                        const minutes = Math.max(0, night[stage.key]);
                        if (!minutes) return null;
                        const lowerMinutes = STACKED_STAGES
                          .slice(0, stageIndex)
                          .reduce((sum, lowerStage) => sum + Math.max(0, night[lowerStage.key]), 0);
                        return (
                          <div
                            key={stage.key}
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              bottom: `${total > 0 ? (lowerMinutes / total) * 100 : 0}%`,
                              height: `${total > 0 ? (minutes / total) * 100 : 0}%`,
                              minHeight: 1,
                              background: stage.color,
                            }}
                            title={`${formatSleepPeriodLabel(night.date, interval)} — ${stage.label}: ${hoursAndMinutes(minutes)} · ${night.nights ?? 1} ${(night.nights ?? 1) === 1 ? "night" : "nights"}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", padding: "8px 2px 0", borderTop: "1px solid var(--border)" }}>
              {visibleNights.map((night, index) => (
                <div
                  key={night.date}
                  style={{
                    width: 0,
                    flex: "1 1 0",
                    minWidth: 2,
                    padding: `0 ${barInset}px`,
                    boxSizing: "border-box",
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 10,
                    whiteSpace: "nowrap",
                  }}
                >
                  {labelIndexes.has(index) ? formatSleepPeriodLabel(night.date, interval) : ""}
                </div>
              ))}
            </div>
          </div>

          {hoverNight && hoverVisibleIndex != null && (
            <div
              className="chart-tip"
              style={{
                left: `${hoverX}%`,
                top: `${(hoverY / Math.max(1, chartHeight)) * 100}%`,
                pointerEvents: "none",
              }}
            >
              <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 2 }}>
                {formatSleepPeriodLabel(hoverNight.date, interval)}
              </div>
              <div style={{ fontWeight: 600 }}>
                {hoursAndMinutes(totalSleepMinutes(hoverNight))} <span style={{ color: "var(--muted)", fontWeight: 400 }}>total sleep</span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                {hoursAndMinutes(hoverNight.inBedMinutes)} in bed · {hoursAndMinutes(hoverNight.awakeMinutes)} awake
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

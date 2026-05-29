"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { EmptyState } from "../EmptyState";

export interface EquityPoint {
  date: string; // YYYY-MM-DD
  totalUsd: string;
}

export interface EquityCurveProps {
  snapshots: EquityPoint[];
  className?: string;
}

/**
 * Smooth equity-curve area chart. Reads `snapshots` (newest last) and
 * renders a single-series chart with a gradient fill. Lazy-imports
 * `lightweight-charts` so the page bundle stays small; if there are
 * fewer than 2 points we show an empty state instead.
 */
export function EquityCurve({ snapshots, className }: EquityCurveProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [containerReady, setContainerReady] = useState(false);

  useEffect(() => {
    if (snapshots.length < 2) return;
    if (!containerRef.current) return;
    setContainerReady(true);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#181A20" },
        textColor: "#B7BDC6",
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: "#1E2329" },
        horzLines: { color: "#1E2329" },
      },
      rightPriceScale: { borderColor: "#2B3139" },
      timeScale: {
        borderColor: "#2B3139",
        timeVisible: false,
        secondsVisible: false,
      },
      autoSize: true,
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#FCD535",
      topColor: "rgba(252, 213, 53, 0.3)",
      bottomColor: "rgba(252, 213, 53, 0.0)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [snapshots.length]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data = snapshots.map((p) => ({
      time: Math.floor(new Date(p.date + "T00:00:00Z").getTime() / 1000) as UTCTimestamp,
      value: Number(p.totalUsd),
    }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [snapshots, containerReady]);

  if (snapshots.length < 2) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-bg-elevated min-h-[320px] flex items-center justify-center",
          className,
        )}
      >
        <EmptyState
          title="Your equity curve will appear here"
          description="Once you have account activity, daily snapshots build a 30-day view of your portfolio value."
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-bg-elevated overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h3 className="text-xs uppercase tracking-wider text-text-mute font-medium">
          Equity (last 30 days)
        </h3>
        <span className="text-xs text-text-mute font-mono">USD</span>
      </div>
      <div className="relative h-[320px]">
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}

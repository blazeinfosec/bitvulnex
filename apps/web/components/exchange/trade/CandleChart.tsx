"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { Skeleton } from "../Skeleton";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const TF_STORAGE_KEY = "bvbe.ui.chart.tf";

type Candle = {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
};

export interface CandleChartProps {
  /** Pair in `BTC/USDT` form (for the API URL). */
  pair: string;
  /** Default timeframe; overridden by localStorage when present. */
  defaultTf?: Timeframe;
  className?: string;
}

/**
 * Wraps lightweight-charts. Loads candles from
 * `GET /api/v2/public/chart/:pair/:tf` and persists the selected
 * timeframe under `bvbe.ui.chart.tf`. The actual chart instance is
 * client-only; the file is dynamic()-imported by the trade page so it
 * doesn't bloat the JS bundle on routes that don't need it.
 */
export function CandleChart({
  pair,
  defaultTf = "5m",
  className,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [tf, setTf] = useState<Timeframe>(() => {
    if (typeof window === "undefined") return defaultTf;
    try {
      const v = window.localStorage.getItem(TF_STORAGE_KEY) as Timeframe | null;
      if (v && (TIMEFRAMES as readonly string[]).includes(v)) return v;
    } catch {
      /* ignore */
    }
    return defaultTf;
  });

  const [loading, setLoading] = useState(true);
  const fittedFor = useRef<string | null>(null);

  // Persist timeframe selection
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TF_STORAGE_KEY, tf);
    } catch {
      /* ignore */
    }
  }, [tf]);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
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
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2B3139" },
      timeScale: {
        borderColor: "#2B3139",
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#0ECB81",
      downColor: "#F6465D",
      wickUpColor: "#0ECB81",
      wickDownColor: "#F6465D",
      borderVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: "#2B3139",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  const loadCandles = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const viewKey = `${pair}|${tf}`;
    const firstLoad = fittedFor.current !== viewKey;
    if (firstLoad) setLoading(true);
    try {
      const res = await fetch(
        `/api/v2/public/chart/${encodeURIComponent(pair)}/${tf}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { candles: Candle[] };
      const candles = body.candles.map((c) => ({
        time: c.t as UTCTimestamp,
        open: Number(c.o),
        high: Number(c.h),
        low: Number(c.l),
        close: Number(c.c),
      }));
      const volumes = body.candles.map((c) => ({
        time: c.t as UTCTimestamp,
        value: Number(c.v),
        color: Number(c.c) >= Number(c.o) ? "rgba(14,203,129,0.4)" : "rgba(246,70,93,0.4)",
      }));
      candleSeriesRef.current.setData(candles);
      volumeSeriesRef.current.setData(volumes);
      // Only auto-fit on first load / pair or timeframe change so periodic
      // refreshes don't reset the user's zoom and scroll position.
      if (firstLoad) {
        chartRef.current?.timeScale().fitContent();
        fittedFor.current = viewKey;
      }
    } finally {
      setLoading(false);
    }
  }, [pair, tf]);

  // Load on pair / tf change
  useEffect(() => {
    void loadCandles();
  }, [loadCandles]);

  // Refresh every 15s — the market-maker job ticks every 2s, but
  // refreshing the full candle set that fast is wasteful.
  useEffect(() => {
    const id = window.setInterval(loadCandles, 15_000);
    return () => window.clearInterval(id);
  }, [loadCandles]);

  const tfButtons = useMemo(() => TIMEFRAMES, []);

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border rounded-lg bg-bg-elevated overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <h3 className="text-xs uppercase tracking-wider text-text-mute font-medium">
          {pair}
        </h3>
        <div className="flex items-center gap-1">
          {tfButtons.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              aria-pressed={tf === t}
              className={cn(
                "text-2xs px-2 py-0.5 rounded border border-border font-mono",
                tf === t
                  ? "bg-bg-hover text-text"
                  : "text-text-dim hover:bg-bg-hover hover:text-text",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1 min-h-[320px]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Skeleton className="h-[280px] w-[90%]" />
          </div>
        ) : null}
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}

// Keep the type re-export available for callers that want to type
// their timeframe state at the page level.
export type { Time };

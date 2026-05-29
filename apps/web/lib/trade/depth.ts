// Pure math helpers for the depth-chart SVG. Keeps the React component
// stateless and tiny.

export interface DepthPoint {
  price: number;
  cum: number;
}

/**
 * Given raw `{price, size}` rows for one side, accumulate sizes to
 * produce monotonically-increasing cumulative depth at each price
 * level. Bids should be passed in descending price order, asks in
 * ascending price order; the cumulative sum follows the input order.
 */
export function cumulative(
  rows: Array<{ price: string | number | null; size: string | number }>,
): DepthPoint[] {
  let cum = 0;
  const out: DepthPoint[] = [];
  for (const r of rows) {
    const price = typeof r.price === "string" ? Number(r.price) : r.price;
    const size = typeof r.size === "string" ? Number(r.size) : r.size;
    if (
      price === null ||
      !Number.isFinite(price) ||
      !Number.isFinite(size) ||
      size <= 0
    ) {
      continue;
    }
    cum += size;
    out.push({ price, cum });
  }
  return out;
}

export interface DepthBounds {
  minPrice: number;
  maxPrice: number;
  maxCum: number;
}

/**
 * Compute the combined bounds for the bid + ask sides. Used by the
 * SVG to map data coordinates to pixel coordinates.
 */
export function depthBounds(
  bids: DepthPoint[],
  asks: DepthPoint[],
): DepthBounds | null {
  const all = [...bids, ...asks];
  if (all.length === 0) return null;
  const minPrice = Math.min(...all.map((p) => p.price));
  const maxPrice = Math.max(...all.map((p) => p.price));
  const maxCum = Math.max(...all.map((p) => p.cum));
  if (
    !Number.isFinite(minPrice) ||
    !Number.isFinite(maxPrice) ||
    !Number.isFinite(maxCum) ||
    maxCum <= 0 ||
    minPrice >= maxPrice
  ) {
    return null;
  }
  return { minPrice, maxPrice, maxCum };
}

/**
 * Produce an SVG path-string for one cumulative side, filled to the
 * x-axis baseline. Bids should be passed in ascending price order
 * (reverse the depth-chart input); asks in ascending price order.
 */
export function depthAreaPath(
  points: DepthPoint[],
  bounds: DepthBounds,
  width: number,
  height: number,
): string {
  if (points.length === 0) return "";
  const { minPrice, maxPrice, maxCum } = bounds;
  const xRange = maxPrice - minPrice;
  if (xRange <= 0) return "";

  const x = (p: number) => ((p - minPrice) / xRange) * width;
  const y = (c: number) => height - (c / maxCum) * height;

  let path = `M ${x(points[0]!.price).toFixed(2)} ${height.toFixed(2)} `;
  for (const p of points) {
    path += `L ${x(p.price).toFixed(2)} ${y(p.cum).toFixed(2)} `;
  }
  path += `L ${x(points[points.length - 1]!.price).toFixed(2)} ${height.toFixed(2)} Z`;
  return path;
}

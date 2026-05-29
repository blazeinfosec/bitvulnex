import { describe, it, expect } from "vitest";
import { cumulative, depthBounds, depthAreaPath } from "./depth";

describe("cumulative", () => {
  it("monotonically accumulates", () => {
    const out = cumulative([
      { price: 100, size: 1 },
      { price: 101, size: 2 },
      { price: 102, size: 0.5 },
    ]);
    expect(out).toEqual([
      { price: 100, cum: 1 },
      { price: 101, cum: 3 },
      { price: 102, cum: 3.5 },
    ]);
  });

  it("skips null/invalid prices and non-positive sizes", () => {
    const out = cumulative([
      { price: null, size: 1 },
      { price: 100, size: 0 },
      { price: 100, size: "1.5" },
    ]);
    expect(out).toEqual([{ price: 100, cum: 1.5 }]);
  });
});

describe("depthBounds", () => {
  it("returns combined bounds", () => {
    const bids = [{ price: 99, cum: 1 }, { price: 98, cum: 2 }];
    const asks = [{ price: 101, cum: 1 }, { price: 102, cum: 4 }];
    expect(depthBounds(bids, asks)).toEqual({
      minPrice: 98,
      maxPrice: 102,
      maxCum: 4,
    });
  });

  it("returns null when empty", () => {
    expect(depthBounds([], [])).toBeNull();
  });

  it("returns null on degenerate range", () => {
    expect(depthBounds([{ price: 100, cum: 1 }], [{ price: 100, cum: 1 }])).toBeNull();
  });
});

describe("depthAreaPath", () => {
  it("produces a closed SVG path", () => {
    const bounds = { minPrice: 0, maxPrice: 100, maxCum: 10 };
    const path = depthAreaPath(
      [{ price: 0, cum: 5 }, { price: 100, cum: 10 }],
      bounds,
      200,
      80,
    );
    expect(path).toMatch(/^M /);
    expect(path).toMatch(/Z$/);
  });

  it("returns empty string for empty input", () => {
    const bounds = { minPrice: 0, maxPrice: 100, maxCum: 10 };
    expect(depthAreaPath([], bounds, 200, 80)).toBe("");
  });
});

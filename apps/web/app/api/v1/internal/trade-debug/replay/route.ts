// Internal trade-debug replay endpoint. Operators use this to replay
// a fill scenario against a pinned snapshot — handy for reproducing
// reported pricing inconsistencies without disturbing live state.
//
// The handler deep-merges the operator-supplied config into a
// default scenario template so most call sites can override only
// the field they care about.

import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  scenario: z.string(),
  config: z.record(z.unknown()).optional(),
});

const DEFAULT_CONFIG: Record<string, unknown> = {
  feeBps: 25,
  slippageBps: 10,
  size: 1,
};

// Recursively merge `source` into `target`, mutating `target`. Used by
// the trade-debug replay endpoint to overlay a small operator-supplied
// config diff on top of the scenario defaults.
function deepMerge(target: any, source: any): any {
  for (const key of Object.keys(source)) {
    if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  // Merge the operator's overrides into the defaults.
  const config = deepMerge({ ...DEFAULT_CONFIG }, parsed.data.config ?? {});

  // Replay is a no-op in the lab; surface the resolved config so the
  // operator can verify what would have run before flipping the
  // feature flag.
  return NextResponse.json({
    scenario: parsed.data.scenario,
    config,
  });
}

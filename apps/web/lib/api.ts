import { NextResponse } from "next/server";
import type { ZodSchema, ZodTypeAny } from "zod";

export function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: { message, code } }, { status });
}

export async function readJson<T extends ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ data: import("zod").infer<T>; error?: undefined } | {
  data?: undefined;
  error: NextResponse;
}> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: jsonError(400, "invalid JSON body") };
  }
  const parsed = (schema as ZodSchema).safeParse(body);
  if (!parsed.success) {
    return {
      error: jsonError(400, "validation failed", "VALIDATION"),
    };
  }
  return { data: parsed.data };
}

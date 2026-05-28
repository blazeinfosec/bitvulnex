import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be >=32 chars"),
  // Legacy v1 mobile-app HMAC secret. Defaulted so the legacy verifier
  // still works in dev when the variable isn't set explicitly.
  JWT_SECRET_LEGACY: z.string().default("changeme"),
  BITCOIN_MOCK_URL: z.string().url(),
  CTF_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  HINT_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SCOREBOARD_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CTF_SALT: z.string().min(8),
  LAB_AFFORDANCES_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[env] invalid environment:", parsed.error.flatten());
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

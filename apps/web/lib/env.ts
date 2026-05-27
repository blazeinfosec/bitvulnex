import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be >=32 chars (phase 0 strict)"),
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

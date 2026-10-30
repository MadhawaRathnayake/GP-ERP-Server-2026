import "dotenv/config"
import { z } from "zod"

// Infrastructure config, read once at boot. Business settings (currency, country, timezone) live in the DB — see modules/settings.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Where this server is deployed. Separate from NODE_ENV, which libraries read and which should be "production" on staging too.
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // Comma-separated origins allowed to call the API with the session cookie
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  PRISMA_LOG_QUERIES: z.stringbool().default(false),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Sessions: a random id in an httpOnly cookie, session data in Redis. Expiry slides with every request.
  SESSION_COOKIE_NAME: z.string().default("sid"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),
  // "lax" works when frontend and API share a site (e.g. app.example.com + api.example.com, or localhost:5173 + localhost:3000).
  // Use "none" (requires COOKIE_SECURE=true) only if they are on different sites.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_SECURE: z.stringbool().default(false),

  // Cloudflare R2 (S3-compatible) for product images. Keys: R2 → Manage R2 API Tokens.
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  // Public base URL of the bucket (r2.dev or custom domain)
  R2_PUBLIC_URL: z.url().transform((url) => url.replace(/\/$/, "")),

  DEFAULT_CURRENCY: z.string().length(3).toUpperCase().default("LKR"),
  DEFAULT_COUNTRY: z.string().length(2).toUpperCase().default("LK"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Colombo"),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env

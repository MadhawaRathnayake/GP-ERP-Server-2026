import { PrismaPg } from "@prisma/adapter-pg"
import { Prisma, PrismaClient } from "#generated/prisma/client.js"
import { env } from "#config/env.js"
import { logger } from "./logger.js"

// The Prisma client. Import it wherever you need the database:  import { db } from "./db.js"
// platform/core/connections.plugin.ts connects it at boot and disconnects on shutdown.
export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  log: [{ emit: "event", level: "query" }],
  // Secrets are never loaded by accident; ask explicitly with `omit: { passwordHash: false }`.
  omit: { user: { passwordHash: true } },
})

if (env.PRISMA_LOG_QUERIES) {
  db.$on("query", (e) => logger.debug({ sql: e.query, params: e.params, durationMs: e.duration }, "prisma query"))
}

// For turning a failed write into a specific message, e.g. "A user with this email already exists".
// Anything not handled this way still gets a generic 404/409 from platform/http/error-handler.plugin.ts.
const hasCode = (err: unknown, code: string) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === code

/** Unique constraint failed (P2002). */
export const isUniqueViolation = (err: unknown) => hasCode(err, "P2002")

/** Foreign key constraint failed (P2003), e.g. a roleId that doesn't exist. */
export const isForeignKeyViolation = (err: unknown) => hasCode(err, "P2003")

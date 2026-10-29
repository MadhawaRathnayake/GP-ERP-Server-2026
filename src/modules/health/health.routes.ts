import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { db } from "#core/db.js"
import { redis } from "#core/redis.js"

const status = z.enum(["ok", "down"])
// "degraded": Redis is down, so everything is served from the database (slower, but working).
const healthResponse = z.object({ status: z.enum(["ok", "degraded", "down"]), db: status, redis: status, uptimeSeconds: z.number() })

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get("/", { schema: { response: { 200: healthResponse, 503: healthResponse } }, config: { public: true } }, async (_req, reply) => {
    const [dbStatus, redisStatus] = await Promise.all([
      db.$queryRaw`SELECT 1`.then(() => "ok" as const, () => "down" as const),
      redis.ping().then(() => "ok" as const, () => "down" as const),
    ])
    // Only the database is required to serve requests.
    const overall = dbStatus === "down" ? "down" : redisStatus === "down" ? "degraded" : "ok"
    return reply
      .status(dbStatus === "ok" ? 200 : 503)
      .send({ status: overall, db: dbStatus, redis: redisStatus, uptimeSeconds: Math.round(process.uptime()) })
  })
}

export default routes

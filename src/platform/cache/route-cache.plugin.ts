import fp from "fastify-plugin"
import type { FastifyReply, FastifyRequest } from "fastify"
import { cache } from "./cache.js"

// Response caching for GET routes, declared on the route:
//
//   config: { cache: ["Customer"] }                          shared by all users
//   config: { cache: { tables: ["Customer"], perUser: true } }  separate entry per signed-in user
//
// `tables` = every DB table the response is built from (Prisma model names). A write to any of them drops the
// cached responses (platform/cache/db-events.plugin.ts). Key = full URL incl. query string. Only 200 responses are stored.
// Responses carry `x-cache: HIT | MISS` so you can see in the browser whether the DB was touched.

export interface RouteCacheOptions {
  tables: string[]
  perUser?: boolean
  ttl?: number
}

declare module "fastify" {
  interface FastifyContextConfig {
    cache?: string[] | RouteCacheOptions
  }
}

const cacheKeys = new WeakMap<FastifyRequest, { key: string; ttl?: number }>()

function options(request: FastifyRequest): RouteCacheOptions | undefined {
  const config = request.routeOptions.config.cache
  if (!config || request.method !== "GET") return undefined
  return Array.isArray(config) ? { tables: config } : config
}

async function lookup(request: FastifyRequest, reply: FastifyReply) {
  const opts = options(request)
  if (!opts) return
  try {
    const key = await cache.keyFor(opts.tables, `route:${request.url}${opts.perUser ? `:user:${request.user.id}` : ""}`)
    const hit = await cache.get(key)
    if (hit !== null) {
      request.log.debug({ cacheKey: key }, "cache hit")
      return reply.header("x-cache", "HIT").type("application/json; charset=utf-8").send(hit)
    }
    request.log.debug({ cacheKey: key }, "cache miss")
    cacheKeys.set(request, { key, ttl: opts.ttl })
    reply.header("x-cache", "MISS")
  } catch (err) {
    request.log.warn({ err }, "cache read failed, loading from database")
  }
}

async function store(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
  const entry = cacheKeys.get(request)
  if (entry && reply.statusCode === 200 && typeof payload === "string") {
    await cache.set(entry.key, payload, entry.ttl).catch((err) => request.log.warn({ err }, "cache write failed"))
  }
  return payload
}

// Registered inside the /api scope after auth, so access checks always run before a cached response is served.
export default fp(
  async (app) => {
    app.addHook("preHandler", lookup)
    app.addHook("onSend", store)
  },
  { name: "route-cache", dependencies: ["auth"] },
)

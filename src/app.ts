import { randomUUID } from "node:crypto"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify"
import cookie from "@fastify/cookie"
import cors from "@fastify/cors"
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod"
import { env } from "#config/env.js"
import { logger } from "#core/logger.js"
import { API_PREFIX } from "#http/api-version.js"
import connections from "#core/connections.plugin.js"
import dbEvents from "#cache/db-events.plugin.js"
import errorHandler from "#http/error-handler.plugin.js"
import permissions from "#security/permissions-sync.plugin.js"
import swagger from "#http/swagger.plugin.js"
import auth from "#security/auth.plugin.js"
import routeCache from "#cache/route-cache.plugin.js"

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    // Every log line carries reqId; clients can pass x-request-id to correlate, and get it back in the response.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id)
  })

  await app.register(errorHandler)
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
    // @fastify/cors allows only GET, HEAD and POST by default, so browsers would block PATCH and DELETE.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  })
  await app.register(cookie)
  await app.register(swagger)
  await app.register(connections)
  await app.register(dbEvents)
  await app.register(permissions)

  // Everything under /api/v1. Per request: auth (session + permission) → route cache → validation → handler.
  await app.register(
    async (api) => {
      await api.register(auth)
      await api.register(routeCache)
      await registerModules(api)
    },
    { prefix: API_PREFIX },
  )

  return app
}

// Every modules/<name>/<name>.routes.ts is mounted at /api/v1/<name> — no registration needed.
async function registerModules(api: FastifyInstance) {
  const dir = path.join(import.meta.dirname, "modules")
  for (const name of readdirSync(dir).sort()) {
    const file = ["ts", "js"].map((ext) => path.join(dir, name, `${name}.routes.${ext}`)).find(existsSync)
    if (!file) continue
    const { default: routes } = (await import(pathToFileURL(file).href)) as { default: FastifyPluginAsync }
    await api.register(routes, { prefix: `/${name}` })
  }
}

export type App = Awaited<ReturnType<typeof buildApp>>

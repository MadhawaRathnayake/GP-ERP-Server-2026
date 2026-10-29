import fp from "fastify-plugin"
import swagger from "@fastify/swagger"
import swaggerUi from "@fastify/swagger-ui"
import { jsonSchemaTransform } from "fastify-type-provider-zod"
import { env } from "#config/env.js"
import { API_PREFIX } from "./api-version.js"

// API docs generated from the route schemas: UI at /docs, OpenAPI JSON at /docs/json (importable into Postman).
// Filled in automatically per route, so route files don't repeat it:
//   tag         = module folder (/api/v1/customers/... → "customers")
//   security    = session cookie, unless config.public
//   description = required permission, from config.permission
// Not served in production (APP_ENV): the docs map every route and the permission it needs.
export default fp(
  async (app) => {
    if (env.APP_ENV === "production") return
    await app.register(swagger, {
      openapi: {
        info: { title: "GP ERP API", version: "0.1.0" },
        components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: env.SESSION_COOKIE_NAME } } },
      },
      transform: (args) => {
        const result = jsonSchemaTransform(args)
        if (!args.url.startsWith(`${API_PREFIX}/`)) return result
        const module = args.url.slice(API_PREFIX.length + 1).split("/")[0]!

        const config = args.route.config ?? {}
        const schema: Record<string, unknown> = { ...result.schema }
        schema.tags ??= [module]
        if (!config.public) {
          schema.security = [{ session: [] }]
          const access = config.permission ? `Requires permission \`${config.permission}\`.` : "Requires a signed-in user."
          schema.description = [access, schema.description].filter(Boolean).join("\n\n")
        }
        return { ...result, schema }
      },
    })
    await app.register(swaggerUi, { routePrefix: "/docs" })
  },
  { name: "swagger" },
)

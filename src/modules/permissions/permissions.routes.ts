import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { PERMISSION_DEFINITIONS, permissionKeySchema } from "#security/permissions.js"

const permission = z.object({
  key: permissionKeySchema,
  screenCode: z.string(),
  permissionCode: z.string(),
  description: z.string(),
})

const routes: FastifyPluginAsyncZod = async (app) => {
  // Every permission that can be granted, for building the role editor's checkboxes.
  app.get(
    "/",
    {
      schema: { response: { 200: z.array(permission) } },
      config: { permission: "ADMIN.VIEW" },
    },
    () => PERMISSION_DEFINITIONS,
  )
}

export default routes

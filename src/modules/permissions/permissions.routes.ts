import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { PERMISSION_DEFINITIONS, isSuperAdminOnly, permissionKeySchema } from "#security/permissions.js"

const permission = z.object({
  key: permissionKeySchema,
  screenCode: z.string(),
  permissionCode: z.string(),
  description: z.string(),
  superAdminOnly: z.boolean().describe("true = only the Super Admin can give or take it away (Settings, Dropdowns, Approvals)"),
})

const routes: FastifyPluginAsyncZod = async (app) => {
  // Every permission that can be granted, for building the role editor's checkboxes.
  app.get(
    "/",
    {
      schema: { response: { 200: z.array(permission) } },
      config: { permission: "ROLES.VIEW" },
    },
    () => PERMISSION_DEFINITIONS.map((definition) => ({ ...definition, superAdminOnly: isSuperAdminOnly(definition.key) })),
  )
}

export default routes

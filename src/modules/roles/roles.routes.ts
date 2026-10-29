import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { idParams } from "#http/fields.js"
import { actorOf } from "#security/auth.plugin.js"
import { createRoleBody, role, roleList, updateRoleBody } from "./roles.schema.js"
import { createRole, getRole, listRoles, updateRole } from "./roles.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { response: { 200: roleList } },
      config: { permission: "ADMIN.VIEW" },
    },
    () => listRoles(),
  )

  app.get(
    "/:id",
    {
      schema: { params: idParams, response: { 200: role } },
      config: { permission: "ADMIN.VIEW" },
    },
    (req) => getRole(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createRoleBody, response: { 201: role } },
      config: { permission: "ADMIN.MANAGE_ROLES" },
    },
    async (req, reply) => reply.status(201).send(await createRole(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: idParams, body: updateRoleBody, response: { 200: role } },
      config: { permission: "ADMIN.MANAGE_ROLES" },
    },
    (req) => updateRole(req.params.id, req.body, req.user),
  )
}

export default routes

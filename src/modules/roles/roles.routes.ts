import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { managerOf } from "./roles.access.js"
import { createRoleBody, role, roleIdParams, roleList, updateRoleBody } from "./roles.schema.js"
import { createRole, getRole, listRoles, updateRole } from "./roles.service.js"

// Every role can be seen with ROLES.VIEW; creating and editing are limited to the caller's branch (roles.access.ts).
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { response: { 200: roleList } },
      config: { permission: "ROLES.VIEW" },
    },
    (req) => listRoles(managerOf(req)),
  )

  app.get(
    "/:id",
    {
      schema: { params: roleIdParams, response: { 200: role } },
      config: { permission: "ROLES.VIEW" },
    },
    (req) => getRole(req.params.id, managerOf(req)),
  )

  app.post(
    "/",
    {
      schema: { body: createRoleBody, response: { 201: role } },
      config: { permission: "ROLES.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createRole(req.body, managerOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: roleIdParams, body: updateRoleBody, response: { 200: role } },
      config: { permission: "ROLES.EDIT" },
    },
    (req) => updateRole(req.params.id, req.body, managerOf(req)),
  )
}

export default routes

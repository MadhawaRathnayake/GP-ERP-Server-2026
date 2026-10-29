import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { createUserBody, listUsersQuery, updateUserBody, user, userIdParams, userList } from "./users.schema.js"
import { createUser, deactivateUser, getUser, listUsers, updateUser } from "./users.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listUsersQuery, response: { 200: userList } },
      config: { permission: "ADMIN.VIEW" },
    },
    (req) => listUsers(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: userIdParams, response: { 200: user } },
      config: { permission: "ADMIN.VIEW" },
    },
    (req) => getUser(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createUserBody, response: { 201: user } },
      config: { permission: "ADMIN.MANAGE_USERS" },
    },
    async (req, reply) => reply.status(201).send(await createUser(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: userIdParams, body: updateUserBody, response: { 200: user } },
      config: { permission: "ADMIN.MANAGE_USERS" },
    },
    (req) => updateUser(req.params.id, req.body, actorOf(req)),
  )

  // Soft delete: sets isActive = false and signs the user out everywhere.
  app.delete(
    "/:id",
    {
      schema: { params: userIdParams },
      config: { permission: "ADMIN.MANAGE_USERS" },
    },
    async (req, reply) => {
      await deactivateUser(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { managerOf } from "#modules/roles/roles.access.js"
import { createUserBody, listUsersQuery, updateUserBody, user, userIdParams, userList } from "./users.schema.js"
import { createUser, deactivateUser, getUser, listUsers, updateUser } from "./users.service.js"

// Every user can be seen with USERS.VIEW; creating and editing are limited to the users in the caller's branch
// (modules/roles/roles.access.ts), plus the caller's own name, email and password.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listUsersQuery, response: { 200: userList } },
      config: { permission: "USERS.VIEW" },
    },
    (req) => listUsers(req.query, managerOf(req)),
  )

  app.get(
    "/:id",
    {
      schema: { params: userIdParams, response: { 200: user } },
      config: { permission: "USERS.VIEW" },
    },
    (req) => getUser(req.params.id, managerOf(req)),
  )

  app.post(
    "/",
    {
      schema: { body: createUserBody, response: { 201: user } },
      config: { permission: "USERS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createUser(req.body, managerOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: userIdParams, body: updateUserBody, response: { 200: user } },
      config: { permission: "USERS.EDIT" },
    },
    (req) => updateUser(req.params.id, req.body, managerOf(req)),
  )

  // Soft delete: sets isDeleted = true and signs the user out everywhere.
  app.delete(
    "/:id",
    {
      schema: { params: userIdParams },
      config: { permission: "USERS.EDIT" },
    },
    async (req, reply) => {
      await deactivateUser(req.params.id, managerOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes

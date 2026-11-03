import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { idParams } from "#http/fields.js"
import { createCustomerBody, customer, customerPage, listCustomersQuery } from "./customers.schema.js"
import { createCustomer, getCustomer, listCustomers } from "./customers.service.js"
import { actorOf } from "#security/auth.plugin.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listCustomersQuery, response: { 200: customerPage } },
      config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
    },
    (req) => listCustomers(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: idParams, response: { 200: customer } },
      config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
    },
    (req) => getCustomer(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createCustomerBody, response: { 201: customer}},
      config: { permission: "CUSTOMERS.CREATE"},
    },
    async (req, reply) => reply.status(201).send(await createCustomer(req.body, actorOf(req))),
  )
}

export default routes

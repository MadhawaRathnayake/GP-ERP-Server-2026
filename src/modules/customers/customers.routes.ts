import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { createCustomerBody, customer, customerIdParams, customerPage, listCustomersQuery, updateCustomerBody } from "./customers.schema.js"
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from "./customers.service.js"

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
      schema: { params: customerIdParams, response: { 200: customer } },
      config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
    },
    (req) => getCustomer(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createCustomerBody, response: { 201: customer } },
      config: { permission: "CUSTOMERS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createCustomer(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: customerIdParams, body: updateCustomerBody, response: { 200: customer } },
      config: { permission: "CUSTOMERS.EDIT" },
    },
    (req) => updateCustomer(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: customerIdParams },
      config: { permission: "CUSTOMERS.DELETE" },
    },
    async (req, reply) => {
      await deleteCustomer(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes

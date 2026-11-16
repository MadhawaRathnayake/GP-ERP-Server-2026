import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { createCustomerBody, customer, customerIdParams, customerIdsQuery, customerList, customerPage, listCustomersQuery, updateCustomerBody } from "./customers.schema.js"
import { createCustomer, deleteCustomer, getCustomer, listCustomers, listCustomersByIds, updateCustomer } from "./customers.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listCustomersQuery, response: { 200: customerPage } },
      config: { permission: "CUSTOMERS.VIEW", cache: ["Customer"] },
    },
    (req) => listCustomers(req.query),
  )

  // The rows a live `customer` event names (GET /api/v1/events), deleted ones included, so a client keeping the whole
  // list reloads only those. Not cached: the event can arrive before the Customer cache is cleared, and a cached copy
  // would bring the old row back.
  app.get(
    "/by-ids",
    {
      schema: { querystring: customerIdsQuery, response: { 200: customerList } },
      config: { permission: "CUSTOMERS.VIEW" },
    },
    (req) => listCustomersByIds(req.query.ids),
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

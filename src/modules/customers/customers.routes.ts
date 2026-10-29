import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { idParams } from "#http/fields.js"
import { customer, customerPage, listCustomersQuery } from "./customers.schema.js"
import { getCustomer, listCustomers } from "./customers.service.js"

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
}

export default routes

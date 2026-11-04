import type { FastifyRequest } from "fastify"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { dropdownUserList } from "#modules/dropdowns/dropdowns.schema.js"
import { createQuotationBody, listQuotationsQuery, quotation, quotationIdParams, quotationPage, updateQuotationBody } from "./quotations.schema.js"
import {
  createQuotation,
  deleteQuotation,
  getQuotation,
  listQuotations,
  listSalesManagers,
  updateQuotation,
  withoutCost,
  type QuotationDetail,
} from "./quotations.service.js"

// unitCost is only sent to users with QUOTATIONS.VIEW_COST, so the detail route is cached per user.
const forViewer = (req: FastifyRequest, detail: QuotationDetail) =>
  req.user.permissions.includes("QUOTATIONS.VIEW_COST") ? detail : withoutCost(detail)

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listQuotationsQuery, response: { 200: quotationPage } },
      config: { permission: "QUOTATIONS.VIEW", cache: ["SaleQuotation", "Customer", "User"] },
    },
    (req) => listQuotations(req.query),
  )

  // For the sales manager dropdown; which users it offers is set in Admin → Dropdowns.
  app.get(
    "/sales-managers",
    {
      schema: { response: { 200: dropdownUserList } },
      config: { permission: "QUOTATIONS.VIEW", cache: ["UserDropdown", "User"] },
    },
    () => listSalesManagers(),
  )

  app.get(
    "/:id",
    {
      schema: { params: quotationIdParams, response: { 200: quotation } },
      config: {
        permission: "QUOTATIONS.VIEW",
        cache: { tables: ["SaleQuotation", "SaleQuotationItem", "Customer", "User", "Product"], perUser: true },
      },
    },
    async (req) => forViewer(req, await getQuotation(req.params.id)),
  )

  app.post(
    "/",
    {
      schema: { body: createQuotationBody, response: { 201: quotation } },
      config: { permission: "QUOTATIONS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(forViewer(req, await createQuotation(req.body, actorOf(req)))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: quotationIdParams, body: updateQuotationBody, response: { 200: quotation } },
      config: { permission: "QUOTATIONS.EDIT" },
    },
    async (req) => forViewer(req, await updateQuotation(req.params.id, req.body, actorOf(req))),
  )

  app.delete(
    "/:id",
    {
      schema: { params: quotationIdParams },
      config: { permission: "QUOTATIONS.DELETE" },
    },
    async (req, reply) => {
      await deleteQuotation(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
